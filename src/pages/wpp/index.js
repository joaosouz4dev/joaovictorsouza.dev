import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

const Wpp = () => {
  const { t } = useTranslation();

  useEffect(() => {
    // get params from url
    const urlParams = new URLSearchParams(window.location.search);
    const phone = urlParams.get('phone');
    const message = urlParams.get('message');

    window.location.href = `https://wa.me/${phone || '5531998587817'}${
      message ? `?text=${message}` : ''
    }`;
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
      <h2>{t('whatsapp.redirecting', 'Redirecting...')}</h2>
    </div>
  );
};

export default Wpp;
