import React from 'react';

const Wpp = ({ phone, message }) => {
  React.useEffect(() => {
    window.location.href = `https://wa.me/${phone || '5531998587817'}?text=${message || ''}`;
  }, []);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
      }}
    >
      <h2>Redirecionando...</h2>
    </div>
  );
};

export default Wpp;
