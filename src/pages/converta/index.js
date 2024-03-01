import React from "react";

function Converta() {
  React.useEffect(() => {
    window.location.href = "https://ibivagas.com.br/welcome-app";
  }, []);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
      }}
    >
      <h2>Carregando...</h2>
    </div>
  );
}

export default Converta;
