import argparse
import concurrent.futures
import csv
import io
import json
import math
from pathlib import Path
import random
import subprocess
import time
from zipfile import ZipFile

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer

MODELS = {
    "bge": ("Xenova/bge-m3", "4de13258303883538bd53b696b452bf8099f0858", "onnx/model_quantized.onnx"),
    "arctic": ("Snowflake/snowflake-arctic-embed-l-v2.0", "ac6544c8a46e00af67e330e85a9028c66b8cfd9a", "onnx/model_quantized.onnx"),
    "bge-to-arctic": ("univec/convert-baai_bge_m3-to-snowflake_arctic_embed_l_v2.0", "44dc6cfa7463f6bc19aa0ad17b22b027f03acbb9", "t2s.direct.inn.ninference-baai_bge-m3.ninference-snowflake_snowflake-arctic-embed-l-v2_0.onnx"),
    "arctic-to-bge": ("univec/convert-snowflake_arctic_embed_l_v2.0-to-baai_bge_m3", "770f80467ff5e665412015c9efc3fde2654b0188", "s2t.direct.inn.ninference-snowflake_snowflake-arctic-embed-l-v2_0.ninference-baai_bge-m3.onnx"),
}
SCIFACT = "https://public.ukp.informatik.tu-darmstadt.de/thakur/BEIR/datasets/scifact.zip"
ARCTIC_QUERY_PREFIX = "query: "


def download(url, path):
    if path.is_file():
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_suffix(path.suffix + ".part")
    for attempt in range(3):
        try:
            print(f"Downloading {path.name} ({path.parent.name})", flush=True)
            subprocess.run(["curl", "--fail", "--location", "--silent", "--show-error", "--connect-timeout", "20", "--max-time", "300", "--output", str(partial), url], check=True)
            partial.replace(path)
            return
        except (OSError, subprocess.CalledProcessError):
            if attempt == 2:
                raise
            time.sleep(2 ** attempt)


def prepare(cache):
    files = [(SCIFACT, cache / "scifact.zip")]
    paths = {}
    for name, (repo, revision, file) in MODELS.items():
        paths[name] = cache / name / Path(file).name
        companions = ["tokenizer.json"] if name in ("bge", "arctic") else [file + ".data"]
        for item in [file, *companions]:
            files.append((f"https://huggingface.co/{repo}/resolve/{revision}/{item}?download=true", cache / name / Path(item).name))
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as workers:
        list(workers.map(lambda spec: download(*spec), files))
    return paths


def sample(path, query_count, document_count):
    with ZipFile(path) as archive:
        def jsonl(member):
            return {row["_id"]: row for row in map(json.loads, archive.read(member).splitlines())}

        documents = jsonl("scifact/corpus.jsonl")
        queries = jsonl("scifact/queries.jsonl")
        qrels = {}
        with io.TextIOWrapper(archive.open("scifact/qrels/test.tsv"), encoding="utf8") as stream:
            for query, document, grade in list(csv.reader(stream, delimiter="\t"))[1:]:
                if int(grade) > 0:
                    qrels.setdefault(query, set()).add(document)
    rng = random.Random(27)
    query_ids = sorted(rng.sample(sorted(qrels), query_count))
    relevant = set.union(*(qrels[query] for query in query_ids))
    document_ids = sorted(relevant | set(rng.sample(sorted(set(documents) - relevant), document_count - len(relevant))))
    return document_ids, [documents[did]["title"] + " " + documents[did]["text"] for did in document_ids], [queries[qid]["text"] for qid in query_ids], [qrels[qid] for qid in query_ids]


def normalize(vectors):
    return vectors / np.linalg.norm(vectors, axis=1, keepdims=True)


def session(path, threads):
    options = ort.SessionOptions()
    options.intra_op_num_threads = threads
    return ort.InferenceSession(str(path), sess_options=options, providers=["CPUExecutionProvider"])


def embed(path, docs, queries, prefix, threads):
    tokenizer = Tokenizer.from_file(str(path.parent / "tokenizer.json"))
    tokenizer.enable_truncation(max_length=256)
    tokenizer.enable_padding(pad_id=1, pad_token="<pad>")
    model = session(path, threads)
    input_names = {entry.name for entry in model.get_inputs()}
    outputs = {entry.name for entry in model.get_outputs()}

    def encode(texts):
        batches = []
        for start in range(0, len(texts), 8):
            tokens = tokenizer.encode_batch(texts[start:start + 8])
            values = {"input_ids": [item.ids for item in tokens], "attention_mask": [item.attention_mask for item in tokens], "token_type_ids": [item.type_ids for item in tokens]}
            feeds = {key: np.asarray(values[key], dtype=np.int64) for key in input_names}
            if "sentence_embedding" in outputs:
                vectors = model.run(["sentence_embedding"], feeds)[0]
            else:
                vectors = model.run(["last_hidden_state"], feeds)[0][:, 0, :]
            batches.append(normalize(vectors))
        return np.vstack(batches)

    return encode(docs), encode([prefix + query for query in queries])


def rank(queries, docs):
    return np.argsort(-(queries @ docs.T), axis=1, kind="stable")[:, :10]


def evaluate(ranks, ids, qrels, reference):
    recalls, ndcgs, overlaps = [], [], []
    for hits, relevant, baseline in zip(ranks, qrels, reference, strict=True):
        matches = [ids[index] in relevant for index in hits]
        recalls.append(sum(matches) / len(relevant))
        discount = [1 / math.log2(i + 2) for i in range(len(hits))]
        ndcgs.append(sum(d for d, hit in zip(discount, matches) if hit) / sum(discount[:len(relevant)]))
        overlaps.append(len(set(hits) & set(baseline)) / len(hits))
    return {"recall_at_10": np.mean(recalls), "ndcg_at_10": np.mean(ndcgs), "overlap_at_10_vs_native": np.mean(overlaps)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--threads", type=int, default=8)
    args = parser.parse_args()
    paths = prepare(args.cache)
    ids, docs, queries, qrels = sample(args.cache / "scifact.zip", 32, 256)
    print("Embedding with BGE-M3", flush=True)
    a_docs, a_queries = embed(paths["bge"], docs, queries, "", args.threads)
    print("Embedding with Snowflake Arctic Embed L v2.0", flush=True)
    b_docs, b_queries = embed(paths["arctic"], docs, queries, ARCTIC_QUERY_PREFIX, args.threads)

    a_native = rank(a_queries, a_docs)
    b_native = rank(b_queries, b_docs)

    converter = session(paths["bge-to-arctic"], args.threads)
    conversion_input = converter.get_inputs()[0].name
    converted_docs = normalize(converter.run(None, {conversion_input: a_docs})[0])
    corpus = rank(b_queries, converted_docs)
    del converter

    bridge = session(paths["arctic-to-bge"], args.threads)
    bridge_input = bridge.get_inputs()[0].name
    def convert(query):
        return normalize(bridge.run(None, {bridge_input: query[None, :]})[0])[0]
    for _ in range(20):
        convert(b_queries[0])
    times, converted_queries = [], []
    for query in b_queries:
        started = time.perf_counter_ns()
        converted_queries.append(convert(query))
        times.append((time.perf_counter_ns() - started) / 1e6)
    query_bridge = rank(np.stack(converted_queries), a_docs)

    results = {
        "dataset": "SciFact (BEIR), seed 27, test queries, sampled corpus with all judged relevant documents for sampled queries",
        "documents": len(docs), "queries": len(queries),
        "encoder_precision": "quantized ONNX", "provider": "ONNX Runtime CPU", "threads": args.threads,
        "bge_native": evaluate(a_native, ids, qrels, a_native),
        "arctic_native": evaluate(b_native, ids, qrels, b_native),
        "corpus_bge_to_arctic": evaluate(corpus, ids, qrels, b_native),
        "query_arctic_to_bge": evaluate(query_bridge, ids, qrels, a_native),
        "query_conversion_only_p95_ms": np.percentile(times, 95),
    }
    args.output.write_text(json.dumps(results, indent=2) + "\n", encoding="utf8")
    print(json.dumps(results, indent=2))

if __name__ == "__main__":
    main()
