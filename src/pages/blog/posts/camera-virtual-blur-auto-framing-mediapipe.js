// Conteudo do artigo: criando minha propria camera virtual com blur e
// auto-framing em Python (substituto focado do NVIDIA Broadcast).
// Formato: { pt, en, es }, cada idioma com
//   { intro, sections: [{ title, blocks: [...] }], faq: [{ question, answer }],
//     conclusion: { title, description, cta }, related: [{ label, to }], repo?: { name, description, url } }

const repo = {
  pt: 'CamFX: app desktop em Python (MediaPipe + OpenCV + pyvirtualcam) que aplica blur de fundo e auto-framing so na webcam e expoe o resultado como camera virtual para Zoom, Meet, Discord e OBS.',
  en: 'CamFX: a Python desktop app (MediaPipe + OpenCV + pyvirtualcam) that applies background blur and auto-framing only to the webcam and exposes the result as a virtual camera for Zoom, Meet, Discord and OBS.',
  es: 'CamFX: app de escritorio en Python (MediaPipe + OpenCV + pyvirtualcam) que aplica blur de fondo y auto-framing solo a la webcam y expone el resultado como camara virtual para Zoom, Meet, Discord y OBS.',
};

const repoUrl = 'https://github.com/joaosouz4dev/cam-fx';

const pt = {
  intro:
    'Eu usava o NVIDIA Broadcast so para uma coisa: desfocar o fundo da minha webcam. So que ele insistia em ser muito mais do que eu pedia. Ativava efeito de ruido no microfone e nos alto-falantes quando eu so queria mexer na camera, e ao ligar o PC abria a janela cheia na minha cara em vez de iniciar quieto na bandeja. Decidi resolver isso construindo minha propria ferramenta: um app de desktop que aplica blur de fundo e auto-framing apenas na camera, expoe o resultado como uma webcam virtual para qualquer programa de chamada e inicia minimizado. Este artigo conta a decisao de arquitetura, o porque de cada escolha tecnica e como o app foi montado e validado.',
  sections: [
    {
      title: 'O problema com o NVIDIA Broadcast',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O NVIDIA Broadcast e uma otima suite, mas para o meu uso ele resolvia demais. Tres incomodos concretos me empurraram para construir algo proprio.',
        },
        {
          type: 'list',
          items: [
            'Escopo amplo demais: eu so queria blur na camera, e o app girava em torno de tres dispositivos (camera, microfone e alto-falantes). Cada vez que eu mexia numa coisa, tinha o risco de ativar efeito onde eu nao queria.',
            'Abria maximizado no boot: ao ligar o PC, a janela do Broadcast aparecia inteira na tela, em vez de iniciar minimizada na bandeja. Todo dia eu fechava na mao.',
            'Peso e acoplamento: uma suite grande para uma funcao pequena. Eu queria uma ferramenta enxuta que fizesse so o blur e o enquadramento, do meu jeito.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'A inspiracao veio de um projeto web open source do Takashi Yoshinaga que faz blur de fundo e auto-framing com MediaPipe rodando no navegador. A ideia era exatamente o que eu queria, mas em pagina web nao da para virar webcam dos outros apps. Eu precisava de um aplicativo instalavel no PC que expusesse uma camera virtual.',
        },
      ],
    },
    {
      title: 'Escolhendo a linguagem e a arquitetura',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O requisito que define tudo nao e o blur em si: e fazer o video processado aparecer como uma webcam selecionavel no Zoom, Meet, Discord e OBS. Isso exige registrar uma camera virtual no Windows. Avaliei tres caminhos.',
        },
        {
          type: 'table',
          columns: ['Abordagem', 'Pros', 'Contras'],
          rows: [
            [
              'Electron + JS (igual ao repo original)',
              'Reaproveita o MediaPipe.js do projeto web; UI facil',
              'Criar camera virtual real no Windows a partir do Electron e instavel; bom so para janela de preview',
            ],
            [
              'C# / .NET nativo',
              'App nativo robusto, instalador limpo, camera virtual via DirectShow',
              'MediaPipe em C# e menos direto; desenvolvimento bem mais longo',
            ],
            [
              'Python + pyvirtualcam',
              'MediaPipe oficial, OpenCV maduro, camera virtual pronta via backend do OBS, vira .exe com PyInstaller',
              'Depende do OBS instalado uma vez para registrar o driver da camera virtual',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Escolhi Python. O MediaPipe tem suporte oficial em Python, o OpenCV resolve captura e processamento de imagem com folga, e a biblioteca pyvirtualcam entrega a camera virtual reaproveitando o driver que o OBS Studio ja instala. E o melhor custo-beneficio: chego rapido num app funcional e ainda empacoto tudo num executavel.',
        },
      ],
    },
    {
      title: 'Como o blur de fundo funciona',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O blur depende de separar a pessoa do fundo. Para isso uso o Image Segmenter do MediaPipe com o modelo de selfie segmentation, que devolve, para cada pixel, a confianca de pertencer a pessoa. Com essa mascara, componho a pessoa nitida sobre uma copia desfocada do mesmo frame.',
        },
        {
          type: 'code',
          value: `import cv2
import numpy as np
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision

options = vision.ImageSegmenterOptions(
    base_options=mp_python.BaseOptions(model_asset_path="selfie_segmenter.tflite"),
    running_mode=vision.RunningMode.VIDEO,
    output_confidence_masks=True,
)
segmenter = vision.ImageSegmenter.create_from_options(options)

def blur_background(frame_bgr, ts_ms, strength=25, threshold=0.5):
    rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
    image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
    result = segmenter.segment_for_video(image, ts_ms)

    confidence = result.confidence_masks[0].numpy_view()  # [0..1] por pixel
    mask = (confidence >= threshold).astype(np.float32)
    mask = cv2.GaussianBlur(mask, (7, 7), 0)              # suaviza a borda

    k = strength | 1                                      # kernel impar
    blurred = cv2.GaussianBlur(frame_bgr, (k, k), 0)
    alpha = mask[:, :, None]
    out = frame_bgr * alpha + blurred * (1.0 - alpha)     # composicao alpha
    return out.astype(np.uint8)`,
        },
        {
          type: 'paragraph',
          value:
            'Dois cuidados fazem diferenca na qualidade: binarizar a mascara num limiar e depois suavizar a borda com um leve blur gaussiano, para a transicao entre pessoa e fundo nao ficar serrilhada; e usar o modo VIDEO do segmenter passando o timestamp de cada frame, o que da rastreamento temporal e estabiliza o resultado quadro a quadro.',
        },
      ],
    },
    {
      title: 'Como o auto-framing funciona',
      blocks: [
        {
          type: 'paragraph',
          value:
            'O auto-framing mantem seu rosto sempre bem enquadrado, como se a camera te seguisse. Detecto o rosto com o Face Detector do MediaPipe (BlazeFace), calculo um retangulo de corte centrado nele com um zoom configuravel e redimensiono esse corte de volta ao tamanho de saida. O segredo para nao tremer e suavizar o movimento com media exponencial, a mesma ideia do projeto original.',
        },
        {
          type: 'code',
          value: `def smooth(prev, target, factor=0.9):
    # factor alto = movimento mais suave e mais lento a reagir.
    if prev is None:
        return target
    return tuple(factor * p + (1 - factor) * t for p, t in zip(prev, target))

def target_crop(detection, w, h, zoom=1.4):
    box = detection.bounding_box
    cx = box.origin_x + box.width / 2
    cy = box.origin_y + box.height / 2
    return (cx, cy, w / zoom, h / zoom)  # centro no rosto, area reduzida pelo zoom`,
        },
        {
          type: 'paragraph',
          value:
            'A cada frame eu calculo o corte alvo a partir do rosto, misturo com o corte anterior pela media exponencial e fixo o resultado dentro dos limites da imagem. Quando nenhum rosto e detectado, o enquadramento relaxa devagar de volta para o frame cheio, em vez de saltar.',
        },
      ],
    },
    {
      title: 'A camera virtual: a peca central',
      blocks: [
        {
          type: 'paragraph',
          value:
            'De nada adianta processar o video se ele nao aparece como webcam nos outros programas. Esse e o papel do pyvirtualcam, que no Windows usa o driver da camera virtual do OBS Studio. Por isso o OBS precisa estar instalado uma vez (nem precisa abrir): ele registra o driver que o app reutiliza. O loop e simples: capturo da camera fisica, aplico os efeitos e envio o frame para a camera virtual.',
        },
        {
          type: 'code',
          value: `import pyvirtualcam
from pyvirtualcam import PixelFormat

cap = cv2.VideoCapture(camera_index, cv2.CAP_DSHOW)
with pyvirtualcam.Camera(width=1280, height=720, fps=30, fmt=PixelFormat.BGR) as cam:
    while running:
        ok, frame = cap.read()
        if not ok:
            break
        frame = auto_framing(frame, ts)     # 1) enquadra no rosto
        frame = blur_background(frame, ts)  # 2) desfoca o fundo
        cam.send(frame)
        cam.sleep_until_next_frame()`,
        },
        {
          type: 'diagram',
          value: `camera fisica
   -> OpenCV (captura)
      -> auto-framing  (FaceDetector + corte suavizado)
         -> blur de fundo (ImageSegmenter + composicao alpha)
            -> pyvirtualcam (OBS Virtual Camera)
               -> Zoom / Meet / Discord / OBS`,
        },
      ],
    },
    {
      title: 'Uma armadilha real: capturar a propria camera virtual',
      blocks: [
        {
          type: 'paragraph',
          value:
            'No teste de ponta a ponta apareceu um problema que vale registrar. Ao listar as cameras pelo OpenCV, a OBS Virtual Camera tambem aparece como um dispositivo de entrada. Se o app captura ela por engano, voce acaba enquadrando a tela de standby do OBS em vez do seu rosto, ou cria um loop de video. A correcao foi enumerar as cameras pelo nome (via DirectShow) e filtrar qualquer dispositivo cujo nome contenha "OBS Virtual", deixando so as cameras fisicas na lista de entrada.',
        },
        {
          type: 'code',
          value: `from pygrabber.dshow_graph import FilterGraph

VIRTUAL_HINTS = ("obs virtual", "obs-camera", "obs cam")

def list_cameras():
    devices = FilterGraph().get_input_devices()  # nomes na ordem de indice do OpenCV
    return [
        (i, name)
        for i, name in enumerate(devices)
        if not any(h in name.lower() for h in VIRTUAL_HINTS)
    ]`,
        },
        {
          type: 'paragraph',
          value:
            'Para confirmar que o efeito realmente acontece, alem da inspecao visual eu medi a variancia do Laplaciano (um indicador de nitidez) no centro do frame, onde fica a pessoa, e num canto, onde fica o fundo. O centro deu cerca de 680 e o canto perto de zero, ou seja, fundo desfocado e pessoa preservada nitida, exatamente o esperado.',
        },
      ],
    },
    {
      title: 'Resolvendo as queixas: bandeja e inicio minimizado',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Os dois incomodos que me motivaram viraram requisitos explicitos. Primeiro, escopo: o app mexe so na camera, ponto. Nao toca em microfone nem em alto-falantes, porque simplesmente nao lida com audio. Segundo, comportamento de inicializacao: um icone na bandeja do sistema (com pystray) permite rodar minimizado, pausar e retomar; e o inicio com o Windows registra o app no boot ja com a flag de iniciar minimizado, o oposto do Broadcast abrindo maximizado.',
        },
        {
          type: 'code',
          value: `import winreg, sys

RUN_KEY = r"Software\\Microsoft\\Windows\\CurrentVersion\\Run"

def set_autostart(enabled):
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as key:
        if enabled:
            cmd = f'"{sys.executable}" --minimized'  # abre direto na bandeja
            winreg.SetValueEx(key, "CamFX", 0, winreg.REG_SZ, cmd)
        else:
            winreg.DeleteValue(key, "CamFX")`,
        },
      ],
    },
    {
      title: 'Empacotando como executavel',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Para virar algo instalavel, gerei um executavel unico com o PyInstaller. O detalhe importante e empacotar junto os modelos .tflite do MediaPipe e os assets internos da biblioteca, para o app rodar sem depender de download na primeira vez. Os modelos sao baixados automaticamente na primeira execucao a partir do fonte e ficam em cache na pasta do usuario; no executavel, vao embutidos.',
        },
        {
          type: 'code',
          value: `pyinstaller --onefile --windowed --name CamFX \\
  --collect-all mediapipe \\
  --add-data "selfie_segmenter.tflite;models" \\
  --add-data "blaze_face_short_range.tflite;models" \\
  main.py`,
        },
        {
          type: 'paragraph',
          value:
            'Resultado: um CamFX.exe que abre, deixa escolher a camera, ligar blur e auto-framing com controles de intensidade, e manda o video para a camera virtual. No Zoom ou no Meet basta selecionar a OBS Virtual Camera como webcam. Fazendo so o que eu precisava, do jeito que eu queria.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Por que precisa do OBS instalado?',
      answer:
        'O pyvirtualcam, no Windows, usa o driver da camera virtual que o OBS Studio registra ao ser instalado. Voce nao precisa abrir o OBS, apenas instala-lo uma vez para que o driver exista. A partir dai o CamFX cria a camera virtual sozinho e o video processado aparece como a webcam OBS Virtual Camera nos outros aplicativos.',
    },
    {
      question: 'Da para rodar sem placa NVIDIA?',
      answer:
        'Sim. Diferente do NVIDIA Broadcast, que exige GPU NVIDIA RTX, o CamFX roda o MediaPipe na CPU por padrao. Nos meus testes, blur e auto-framing juntos em 720p rodaram em torno de 13 FPS na CPU, suficiente para chamadas; em maquinas mais fortes ou reduzindo a resolucao, o numero sobe.',
    },
    {
      question: 'Por que o efeito so na camera e nao no audio?',
      answer:
        'Por escolha de escopo. O incomodo que me levou a construir a ferramenta era justamente o efeito vazar para microfone e alto-falantes quando eu so queria mexer na camera. O CamFX nao lida com audio de proposito: ele captura video, processa e expoe uma camera virtual, e nada mais.',
    },
  ],
  conclusion: {
    title: 'Uma ferramenta que faz so o que voce precisa',
    description:
      'Construir o proprio substituto do NVIDIA Broadcast me deu exatamente o que eu queria: blur e auto-framing so na camera, inicio minimizado na bandeja e nenhum efeito indesejado no audio. Se voce tem um incomodo parecido com uma ferramenta grande demais para a sua necessidade, posso ajudar a desenhar e construir a solucao enxuta certa.',
    cta: 'Conversar sobre um projeto sob medida',
  },
  related: [
    { label: 'CAG x RAG: quando cache de contexto vence retrieval', to: '/blog/cag-vs-rag-cache-contexto' },
    { label: 'ROI real de automacao com IA', to: '/blog/roi-real-automacao-ia' },
  ],
  repo: { name: 'cam-fx', description: repo.pt, url: repoUrl },
};

const en = {
  intro:
    'I used NVIDIA Broadcast for exactly one thing: blurring my webcam background. The trouble is it insisted on being far more than I asked for. It enabled noise effects on the microphone and speakers when all I wanted was the camera, and on boot it opened the full window in my face instead of starting quietly in the tray. I decided to fix this by building my own tool: a desktop app that applies background blur and auto-framing only to the camera, exposes the result as a virtual webcam for any call app and starts minimized. This article covers the architecture decision, why each technical choice was made and how the app was built and validated.',
  sections: [
    {
      title: 'The problem with NVIDIA Broadcast',
      blocks: [
        {
          type: 'paragraph',
          value:
            'NVIDIA Broadcast is a great suite, but for my use it solved too much. Three concrete annoyances pushed me to build my own.',
        },
        {
          type: 'list',
          items: [
            'Scope too broad: I only wanted camera blur, and the app revolved around three devices (camera, microphone and speakers). Every time I touched one thing, I risked enabling an effect where I did not want it.',
            'Opened maximized on boot: when I turned on the PC, the Broadcast window appeared full on screen instead of starting minimized in the tray. I closed it by hand every day.',
            'Weight and coupling: a big suite for a small function. I wanted a lean tool that did only blur and framing, my way.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'The inspiration came from an open source web project by Takashi Yoshinaga that does background blur and auto-framing with MediaPipe running in the browser. The idea was exactly what I wanted, but a web page cannot become a webcam for other apps. I needed an installable PC application that exposed a virtual camera.',
        },
      ],
    },
    {
      title: 'Choosing the language and architecture',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The requirement that drives everything is not the blur itself: it is making the processed video show up as a selectable webcam in Zoom, Meet, Discord and OBS. That requires registering a virtual camera on Windows. I weighed three paths.',
        },
        {
          type: 'table',
          columns: ['Approach', 'Pros', 'Cons'],
          rows: [
            [
              'Electron + JS (like the original repo)',
              'Reuses the web project MediaPipe.js; easy UI',
              'Creating a real virtual camera on Windows from Electron is unstable; good only for a preview window',
            ],
            [
              'C# / .NET native',
              'Robust native app, clean installer, virtual camera via DirectShow',
              'MediaPipe in C# is less direct; much longer development',
            ],
            [
              'Python + pyvirtualcam',
              'Official MediaPipe, mature OpenCV, virtual camera ready via the OBS backend, builds to .exe with PyInstaller',
              'Depends on OBS installed once to register the virtual camera driver',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'I chose Python. MediaPipe has official Python support, OpenCV handles capture and image processing with room to spare, and pyvirtualcam delivers the virtual camera by reusing the driver OBS Studio already installs. It is the best cost-benefit: I reach a working app quickly and still package everything into an executable.',
        },
      ],
    },
    {
      title: 'How background blur works',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Blur depends on separating the person from the background. For that I use the MediaPipe Image Segmenter with the selfie segmentation model, which returns, for each pixel, the confidence of belonging to the person. With that mask, I composite the sharp person over a blurred copy of the same frame.',
        },
        {
          type: 'code',
          value: `import cv2
import numpy as np
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision

options = vision.ImageSegmenterOptions(
    base_options=mp_python.BaseOptions(model_asset_path="selfie_segmenter.tflite"),
    running_mode=vision.RunningMode.VIDEO,
    output_confidence_masks=True,
)
segmenter = vision.ImageSegmenter.create_from_options(options)

def blur_background(frame_bgr, ts_ms, strength=25, threshold=0.5):
    rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
    image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
    result = segmenter.segment_for_video(image, ts_ms)

    confidence = result.confidence_masks[0].numpy_view()  # [0..1] per pixel
    mask = (confidence >= threshold).astype(np.float32)
    mask = cv2.GaussianBlur(mask, (7, 7), 0)              # soften the edge

    k = strength | 1                                      # odd kernel
    blurred = cv2.GaussianBlur(frame_bgr, (k, k), 0)
    alpha = mask[:, :, None]
    out = frame_bgr * alpha + blurred * (1.0 - alpha)     # alpha composite
    return out.astype(np.uint8)`,
        },
        {
          type: 'paragraph',
          value:
            'Two details make a difference in quality: binarizing the mask at a threshold and then softening the edge with a light Gaussian blur, so the transition between person and background does not look jagged; and using the segmenter VIDEO mode passing each frame timestamp, which gives temporal tracking and stabilizes the result frame by frame.',
        },
      ],
    },
    {
      title: 'How auto-framing works',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Auto-framing keeps your face well framed at all times, as if the camera followed you. I detect the face with the MediaPipe Face Detector (BlazeFace), compute a crop rectangle centered on it with a configurable zoom and resize that crop back to the output size. The trick to avoid shaking is smoothing the motion with an exponential average, the same idea as the original project.',
        },
        {
          type: 'code',
          value: `def smooth(prev, target, factor=0.9):
    # high factor = smoother motion, slower to react.
    if prev is None:
        return target
    return tuple(factor * p + (1 - factor) * t for p, t in zip(prev, target))

def target_crop(detection, w, h, zoom=1.4):
    box = detection.bounding_box
    cx = box.origin_x + box.width / 2
    cy = box.origin_y + box.height / 2
    return (cx, cy, w / zoom, h / zoom)  # centered on the face, area reduced by zoom`,
        },
        {
          type: 'paragraph',
          value:
            'On each frame I compute the target crop from the face, blend it with the previous crop via the exponential average and clamp the result within the image bounds. When no face is detected, the framing relaxes slowly back to the full frame, instead of jumping.',
        },
      ],
    },
    {
      title: 'The virtual camera: the central piece',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Processing the video is pointless if it does not show up as a webcam in other programs. That is the role of pyvirtualcam, which on Windows uses the OBS Studio virtual camera driver. That is why OBS must be installed once (you do not even need to open it): it registers the driver the app reuses. The loop is simple: capture from the physical camera, apply the effects and send the frame to the virtual camera.',
        },
        {
          type: 'code',
          value: `import pyvirtualcam
from pyvirtualcam import PixelFormat

cap = cv2.VideoCapture(camera_index, cv2.CAP_DSHOW)
with pyvirtualcam.Camera(width=1280, height=720, fps=30, fmt=PixelFormat.BGR) as cam:
    while running:
        ok, frame = cap.read()
        if not ok:
            break
        frame = auto_framing(frame, ts)     # 1) frame on the face
        frame = blur_background(frame, ts)  # 2) blur the background
        cam.send(frame)
        cam.sleep_until_next_frame()`,
        },
        {
          type: 'diagram',
          value: `physical camera
   -> OpenCV (capture)
      -> auto-framing  (FaceDetector + smoothed crop)
         -> background blur (ImageSegmenter + alpha composite)
            -> pyvirtualcam (OBS Virtual Camera)
               -> Zoom / Meet / Discord / OBS`,
        },
      ],
    },
    {
      title: 'A real pitfall: capturing your own virtual camera',
      blocks: [
        {
          type: 'paragraph',
          value:
            'During the end-to-end test a problem worth recording came up. When listing cameras through OpenCV, the OBS Virtual Camera also shows up as an input device. If the app captures it by mistake, you end up framing the OBS standby screen instead of your face, or create a video loop. The fix was to enumerate cameras by name (via DirectShow) and filter out any device whose name contains "OBS Virtual", leaving only the physical cameras in the input list.',
        },
        {
          type: 'code',
          value: `from pygrabber.dshow_graph import FilterGraph

VIRTUAL_HINTS = ("obs virtual", "obs-camera", "obs cam")

def list_cameras():
    devices = FilterGraph().get_input_devices()  # names in OpenCV index order
    return [
        (i, name)
        for i, name in enumerate(devices)
        if not any(h in name.lower() for h in VIRTUAL_HINTS)
    ]`,
        },
        {
          type: 'paragraph',
          value:
            'To confirm the effect actually happens, beyond visual inspection I measured the variance of the Laplacian (a sharpness indicator) at the center of the frame, where the person is, and at a corner, where the background is. The center came in around 680 and the corner near zero, meaning blurred background and sharp preserved person, exactly as expected.',
        },
      ],
    },
    {
      title: 'Solving the complaints: tray and minimized start',
      blocks: [
        {
          type: 'paragraph',
          value:
            'The two annoyances that motivated me became explicit requirements. First, scope: the app touches only the camera, full stop. It does not touch the microphone or speakers, because it simply does not handle audio. Second, startup behavior: a system tray icon (with pystray) lets it run minimized, pause and resume; and start with Windows registers the app at boot with the start-minimized flag, the opposite of Broadcast opening maximized.',
        },
        {
          type: 'code',
          value: `import winreg, sys

RUN_KEY = r"Software\\Microsoft\\Windows\\CurrentVersion\\Run"

def set_autostart(enabled):
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as key:
        if enabled:
            cmd = f'"{sys.executable}" --minimized'  # opens straight into the tray
            winreg.SetValueEx(key, "CamFX", 0, winreg.REG_SZ, cmd)
        else:
            winreg.DeleteValue(key, "CamFX")`,
        },
      ],
    },
    {
      title: 'Packaging as an executable',
      blocks: [
        {
          type: 'paragraph',
          value:
            'To make it installable, I generated a single executable with PyInstaller. The important detail is packaging the MediaPipe .tflite models and the library internal assets along with it, so the app runs without depending on a download the first time. The models are downloaded automatically on the first run from source and cached in the user folder; in the executable, they are embedded.',
        },
        {
          type: 'code',
          value: `pyinstaller --onefile --windowed --name CamFX \\
  --collect-all mediapipe \\
  --add-data "selfie_segmenter.tflite;models" \\
  --add-data "blaze_face_short_range.tflite;models" \\
  main.py`,
        },
        {
          type: 'paragraph',
          value:
            'Result: a CamFX.exe that opens, lets you pick the camera, enable blur and auto-framing with intensity controls, and sends the video to the virtual camera. In Zoom or Meet you just select OBS Virtual Camera as the webcam. Doing only what I needed, the way I wanted it.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Why does it need OBS installed?',
      answer:
        'On Windows, pyvirtualcam uses the virtual camera driver that OBS Studio registers when installed. You do not need to open OBS, just install it once so the driver exists. From there CamFX creates the virtual camera on its own and the processed video appears as the OBS Virtual Camera webcam in other applications.',
    },
    {
      question: 'Can it run without an NVIDIA card?',
      answer:
        'Yes. Unlike NVIDIA Broadcast, which requires an NVIDIA RTX GPU, CamFX runs MediaPipe on the CPU by default. In my tests, blur and auto-framing together at 720p ran around 13 FPS on the CPU, enough for calls; on stronger machines or by lowering the resolution, the number goes up.',
    },
    {
      question: 'Why only the camera and not the audio?',
      answer:
        'By scope choice. The annoyance that led me to build the tool was precisely the effect leaking into the microphone and speakers when I only wanted the camera. CamFX deliberately does not handle audio: it captures video, processes it and exposes a virtual camera, nothing more.',
    },
  ],
  conclusion: {
    title: 'A tool that does only what you need',
    description:
      'Building my own NVIDIA Broadcast replacement gave me exactly what I wanted: blur and auto-framing only on the camera, minimized start in the tray and no unwanted audio effects. If you have a similar annoyance with a tool too big for your need, I can help design and build the right lean solution.',
    cta: 'Talk about a custom project',
  },
  related: [
    { label: 'CAG vs RAG: when context cache beats retrieval', to: '/blog/cag-vs-rag-cache-contexto' },
    { label: 'Real ROI of AI automation', to: '/blog/roi-real-automacao-ia' },
  ],
  repo: { name: 'cam-fx', description: repo.en, url: repoUrl },
};

const es = {
  intro:
    'Yo usaba NVIDIA Broadcast para exactamente una cosa: desenfocar el fondo de mi webcam. El problema es que insistia en ser mucho mas de lo que yo pedia. Activaba efectos de ruido en el microfono y los altavoces cuando yo solo queria la camara, y al encender el PC abria la ventana completa en mi cara en vez de iniciar callado en la bandeja. Decidi resolverlo construyendo mi propia herramienta: una app de escritorio que aplica blur de fondo y auto-framing solo a la camara, expone el resultado como una webcam virtual para cualquier app de llamadas e inicia minimizada. Este articulo cuenta la decision de arquitectura, el porque de cada eleccion tecnica y como se construyo y valido la app.',
  sections: [
    {
      title: 'El problema con NVIDIA Broadcast',
      blocks: [
        {
          type: 'paragraph',
          value:
            'NVIDIA Broadcast es una gran suite, pero para mi uso resolvia demasiado. Tres molestias concretas me empujaron a construir lo mio.',
        },
        {
          type: 'list',
          items: [
            'Alcance demasiado amplio: yo solo queria blur en la camara, y la app giraba en torno a tres dispositivos (camara, microfono y altavoces). Cada vez que tocaba algo, arriesgaba activar un efecto donde no queria.',
            'Abria maximizado al arrancar: al encender el PC, la ventana de Broadcast aparecia completa en pantalla en vez de iniciar minimizada en la bandeja. La cerraba a mano todos los dias.',
            'Peso y acoplamiento: una suite grande para una funcion pequena. Yo queria una herramienta liviana que hiciera solo blur y encuadre, a mi manera.',
          ],
        },
        {
          type: 'paragraph',
          value:
            'La inspiracion vino de un proyecto web open source de Takashi Yoshinaga que hace blur de fondo y auto-framing con MediaPipe corriendo en el navegador. La idea era justo lo que yo queria, pero una pagina web no puede convertirse en webcam de otras apps. Yo necesitaba una aplicacion instalable en el PC que expusiera una camara virtual.',
        },
      ],
    },
    {
      title: 'Eligiendo el lenguaje y la arquitectura',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El requisito que define todo no es el blur en si: es lograr que el video procesado aparezca como una webcam seleccionable en Zoom, Meet, Discord y OBS. Eso exige registrar una camara virtual en Windows. Evalue tres caminos.',
        },
        {
          type: 'table',
          columns: ['Enfoque', 'Pros', 'Contras'],
          rows: [
            [
              'Electron + JS (como el repo original)',
              'Reutiliza el MediaPipe.js del proyecto web; UI facil',
              'Crear una camara virtual real en Windows desde Electron es inestable; sirve solo para una ventana de preview',
            ],
            [
              'C# / .NET nativo',
              'App nativa robusta, instalador limpio, camara virtual via DirectShow',
              'MediaPipe en C# es menos directo; desarrollo mucho mas largo',
            ],
            [
              'Python + pyvirtualcam',
              'MediaPipe oficial, OpenCV maduro, camara virtual lista via el backend de OBS, compila a .exe con PyInstaller',
              'Depende de OBS instalado una vez para registrar el driver de la camara virtual',
            ],
          ],
        },
        {
          type: 'paragraph',
          value:
            'Eligi Python. MediaPipe tiene soporte oficial en Python, OpenCV resuelve captura y procesamiento de imagen de sobra, y la libreria pyvirtualcam entrega la camara virtual reutilizando el driver que OBS Studio ya instala. Es el mejor costo-beneficio: llego rapido a una app funcional y ademas empaqueto todo en un ejecutable.',
        },
      ],
    },
    {
      title: 'Como funciona el blur de fondo',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El blur depende de separar a la persona del fondo. Para eso uso el Image Segmenter de MediaPipe con el modelo de selfie segmentation, que devuelve, para cada pixel, la confianza de pertenecer a la persona. Con esa mascara, compongo a la persona nitida sobre una copia desenfocada del mismo frame.',
        },
        {
          type: 'code',
          value: `import cv2
import numpy as np
import mediapipe as mp
from mediapipe.tasks import python as mp_python
from mediapipe.tasks.python import vision

options = vision.ImageSegmenterOptions(
    base_options=mp_python.BaseOptions(model_asset_path="selfie_segmenter.tflite"),
    running_mode=vision.RunningMode.VIDEO,
    output_confidence_masks=True,
)
segmenter = vision.ImageSegmenter.create_from_options(options)

def blur_background(frame_bgr, ts_ms, strength=25, threshold=0.5):
    rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
    image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
    result = segmenter.segment_for_video(image, ts_ms)

    confidence = result.confidence_masks[0].numpy_view()  # [0..1] por pixel
    mask = (confidence >= threshold).astype(np.float32)
    mask = cv2.GaussianBlur(mask, (7, 7), 0)              # suaviza el borde

    k = strength | 1                                      # kernel impar
    blurred = cv2.GaussianBlur(frame_bgr, (k, k), 0)
    alpha = mask[:, :, None]
    out = frame_bgr * alpha + blurred * (1.0 - alpha)     # composicion alpha
    return out.astype(np.uint8)`,
        },
        {
          type: 'paragraph',
          value:
            'Dos cuidados marcan la diferencia en la calidad: binarizar la mascara en un umbral y luego suavizar el borde con un leve blur gaussiano, para que la transicion entre persona y fondo no quede dentada; y usar el modo VIDEO del segmenter pasando el timestamp de cada frame, lo que da seguimiento temporal y estabiliza el resultado cuadro a cuadro.',
        },
      ],
    },
    {
      title: 'Como funciona el auto-framing',
      blocks: [
        {
          type: 'paragraph',
          value:
            'El auto-framing mantiene tu rostro siempre bien encuadrado, como si la camara te siguiera. Detecto el rostro con el Face Detector de MediaPipe (BlazeFace), calculo un rectangulo de recorte centrado en el con un zoom configurable y redimensiono ese recorte de vuelta al tamano de salida. El secreto para no temblar es suavizar el movimiento con media exponencial, la misma idea del proyecto original.',
        },
        {
          type: 'code',
          value: `def smooth(prev, target, factor=0.9):
    # factor alto = movimiento mas suave y mas lento en reaccionar.
    if prev is None:
        return target
    return tuple(factor * p + (1 - factor) * t for p, t in zip(prev, target))

def target_crop(detection, w, h, zoom=1.4):
    box = detection.bounding_box
    cx = box.origin_x + box.width / 2
    cy = box.origin_y + box.height / 2
    return (cx, cy, w / zoom, h / zoom)  # centrado en el rostro, area reducida por el zoom`,
        },
        {
          type: 'paragraph',
          value:
            'En cada frame calculo el recorte objetivo a partir del rostro, lo mezclo con el recorte anterior por la media exponencial y fijo el resultado dentro de los limites de la imagen. Cuando no se detecta ningun rostro, el encuadre se relaja despacio de vuelta al frame completo, en vez de saltar.',
        },
      ],
    },
    {
      title: 'La camara virtual: la pieza central',
      blocks: [
        {
          type: 'paragraph',
          value:
            'De nada sirve procesar el video si no aparece como webcam en los otros programas. Ese es el papel de pyvirtualcam, que en Windows usa el driver de la camara virtual de OBS Studio. Por eso OBS debe estar instalado una vez (ni siquiera hace falta abrirlo): registra el driver que la app reutiliza. El loop es simple: capturo de la camara fisica, aplico los efectos y envio el frame a la camara virtual.',
        },
        {
          type: 'code',
          value: `import pyvirtualcam
from pyvirtualcam import PixelFormat

cap = cv2.VideoCapture(camera_index, cv2.CAP_DSHOW)
with pyvirtualcam.Camera(width=1280, height=720, fps=30, fmt=PixelFormat.BGR) as cam:
    while running:
        ok, frame = cap.read()
        if not ok:
            break
        frame = auto_framing(frame, ts)     # 1) encuadra en el rostro
        frame = blur_background(frame, ts)  # 2) desenfoca el fondo
        cam.send(frame)
        cam.sleep_until_next_frame()`,
        },
        {
          type: 'diagram',
          value: `camara fisica
   -> OpenCV (captura)
      -> auto-framing  (FaceDetector + recorte suavizado)
         -> blur de fondo (ImageSegmenter + composicion alpha)
            -> pyvirtualcam (OBS Virtual Camera)
               -> Zoom / Meet / Discord / OBS`,
        },
      ],
    },
    {
      title: 'Una trampa real: capturar tu propia camara virtual',
      blocks: [
        {
          type: 'paragraph',
          value:
            'En la prueba de punta a punta aparecio un problema que vale la pena registrar. Al listar las camaras por OpenCV, la OBS Virtual Camera tambien aparece como un dispositivo de entrada. Si la app la captura por error, terminas encuadrando la pantalla de standby de OBS en vez de tu rostro, o creas un loop de video. La correccion fue enumerar las camaras por nombre (via DirectShow) y filtrar cualquier dispositivo cuyo nombre contenga "OBS Virtual", dejando solo las camaras fisicas en la lista de entrada.',
        },
        {
          type: 'code',
          value: `from pygrabber.dshow_graph import FilterGraph

VIRTUAL_HINTS = ("obs virtual", "obs-camera", "obs cam")

def list_cameras():
    devices = FilterGraph().get_input_devices()  # nombres en el orden de indice de OpenCV
    return [
        (i, name)
        for i, name in enumerate(devices)
        if not any(h in name.lower() for h in VIRTUAL_HINTS)
    ]`,
        },
        {
          type: 'paragraph',
          value:
            'Para confirmar que el efecto realmente ocurre, ademas de la inspeccion visual medi la varianza del Laplaciano (un indicador de nitidez) en el centro del frame, donde esta la persona, y en una esquina, donde esta el fondo. El centro dio alrededor de 680 y la esquina cerca de cero, es decir, fondo desenfocado y persona preservada nitida, exactamente lo esperado.',
        },
      ],
    },
    {
      title: 'Resolviendo las quejas: bandeja e inicio minimizado',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Las dos molestias que me motivaron se volvieron requisitos explicitos. Primero, alcance: la app toca solo la camara, punto. No toca el microfono ni los altavoces, porque simplemente no maneja audio. Segundo, comportamiento de inicio: un icono en la bandeja del sistema (con pystray) permite correr minimizado, pausar y reanudar; y el inicio con Windows registra la app en el arranque ya con la bandera de iniciar minimizado, lo opuesto a Broadcast abriendo maximizado.',
        },
        {
          type: 'code',
          value: `import winreg, sys

RUN_KEY = r"Software\\Microsoft\\Windows\\CurrentVersion\\Run"

def set_autostart(enabled):
    with winreg.OpenKey(winreg.HKEY_CURRENT_USER, RUN_KEY, 0, winreg.KEY_SET_VALUE) as key:
        if enabled:
            cmd = f'"{sys.executable}" --minimized'  # abre directo en la bandeja
            winreg.SetValueEx(key, "CamFX", 0, winreg.REG_SZ, cmd)
        else:
            winreg.DeleteValue(key, "CamFX")`,
        },
      ],
    },
    {
      title: 'Empaquetando como ejecutable',
      blocks: [
        {
          type: 'paragraph',
          value:
            'Para volverlo instalable, genere un ejecutable unico con PyInstaller. El detalle importante es empaquetar junto los modelos .tflite de MediaPipe y los assets internos de la libreria, para que la app corra sin depender de una descarga la primera vez. Los modelos se descargan automaticamente en la primera ejecucion desde el fuente y quedan en cache en la carpeta del usuario; en el ejecutable, van embebidos.',
        },
        {
          type: 'code',
          value: `pyinstaller --onefile --windowed --name CamFX \\
  --collect-all mediapipe \\
  --add-data "selfie_segmenter.tflite;models" \\
  --add-data "blaze_face_short_range.tflite;models" \\
  main.py`,
        },
        {
          type: 'paragraph',
          value:
            'Resultado: un CamFX.exe que abre, deja elegir la camara, activar blur y auto-framing con controles de intensidad, y envia el video a la camara virtual. En Zoom o Meet basta seleccionar OBS Virtual Camera como webcam. Haciendo solo lo que yo necesitaba, a mi manera.',
        },
      ],
    },
  ],
  faq: [
    {
      question: 'Por que necesita OBS instalado?',
      answer:
        'En Windows, pyvirtualcam usa el driver de la camara virtual que OBS Studio registra al instalarse. No necesitas abrir OBS, solo instalarlo una vez para que el driver exista. A partir de ahi CamFX crea la camara virtual por su cuenta y el video procesado aparece como la webcam OBS Virtual Camera en las otras aplicaciones.',
    },
    {
      question: 'Se puede correr sin tarjeta NVIDIA?',
      answer:
        'Si. A diferencia de NVIDIA Broadcast, que exige GPU NVIDIA RTX, CamFX corre MediaPipe en la CPU por defecto. En mis pruebas, blur y auto-framing juntos en 720p corrieron alrededor de 13 FPS en la CPU, suficiente para llamadas; en maquinas mas potentes o bajando la resolucion, el numero sube.',
    },
    {
      question: 'Por que el efecto solo en la camara y no en el audio?',
      answer:
        'Por eleccion de alcance. La molestia que me llevo a construir la herramienta era justamente el efecto filtrandose al microfono y los altavoces cuando yo solo queria la camara. CamFX deliberadamente no maneja audio: captura video, lo procesa y expone una camara virtual, nada mas.',
    },
  ],
  conclusion: {
    title: 'Una herramienta que hace solo lo que necesitas',
    description:
      'Construir mi propio reemplazo de NVIDIA Broadcast me dio exactamente lo que queria: blur y auto-framing solo en la camara, inicio minimizado en la bandeja y ningun efecto no deseado en el audio. Si tienes una molestia parecida con una herramienta demasiado grande para tu necesidad, puedo ayudar a disenar y construir la solucion liviana correcta.',
    cta: 'Hablar sobre un proyecto a medida',
  },
  related: [
    { label: 'CAG vs RAG: cuando el cache de contexto le gana al retrieval', to: '/blog/cag-vs-rag-cache-contexto' },
    { label: 'ROI real de automatizacion con IA', to: '/blog/roi-real-automacao-ia' },
  ],
  repo: { name: 'cam-fx', description: repo.es, url: repoUrl },
};

export default { pt, en, es };
