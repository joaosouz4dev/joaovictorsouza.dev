import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

const Privacidade = () => {
  const [title, setTitle] = useState("");
  const params = useParams();
  useEffect(() => {
    setTitle(params.title);
  }, [params.title]);
  return (
    <div
      style={{
        textAlign: "justify",
        font: "90% Verdana,Arial,helvica, sans-serif",
        margin: "7%",
      }}
    >
      <h2>Política Privacidade {title ? " - " + title : ""}</h2>

      <p>
        A sua privacidade é importante para nós. É política do {title} respeitar
        a sua privacidade em relação a qualquer informação sua que possamos
        coletar no aplicativo.
      </p>
      <p>
        Solicitamos informações pessoais apenas quando realmente precisamos
        delas para lhe fornecer um serviço. Fazemo-lo por meios justos e legais,
        com o seu conhecimento e consentimento. Também informamos por que
        estamos coletando e como será usado.
      </p>
      <p>
        Apenas retemos as informações coletadas pelo tempo necessário para
        fornecer o serviço solicitado.
      </p>
      <p>
        Não compartilhamos informações de identificação pessoal publicamente ou
        com terceiros, exceto quando exigido por lei.
      </p>
      <p>
        Você é livre para recusar a nossa solicitação de informações pessoais,
        entendendo que talvez não possamos fornecer alguns dos serviços
        desejados.
      </p>

      <h3> Localização </h3>
      <p>
        Pegamos sua localização para preencher em nosso sistema o endereço no
        qual você se encontra. Com o intuito de agilizar a utilização do nosso
        serviço. Assim você não precisa digitar o endereço que se encontra,
        nosso sistema faz isso usando sua localização.
      </p>
      <h3>Mais informações</h3>
      <p>
        Sua localização é usanda somente quando abre a tela do aplicativo. Não
        armazenamos esses dados em nossos servidores.
      </p>

      <p>
        Esta política é efetiva a partir de <strong>Maio</strong>/
        <strong>2021</strong>.
      </p>
    </div>
  );
};

export default Privacidade;
