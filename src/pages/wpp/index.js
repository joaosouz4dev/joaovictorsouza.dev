import React from "react";

function Wpp() {

  React.useEffect(() => {
    window.location.href = "https://wa.me/5531998587817";
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