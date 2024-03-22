import React from "react";

function Wpp() {

  React.useEffect(() => {
    window.location.href = "https://api.whatsapp.com/send?phone=351969823079";
  }, []);

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      height: "100vh",
    }}>
      <h2>Redirecionando...</h2>
    </div>
  );
}

export default Wpp;