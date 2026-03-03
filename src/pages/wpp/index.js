import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import Seo from '../../components/seo';

const Wpp = () => {
  const { t } = useTranslation();

  useEffect(() => {
    // get params from url
    const urlParams = new URLSearchParams(window.location.search);
    const phone = urlParams.get('phone');
    const message = urlParams.get('message');

    setTimeout(() => {
      window.location.href = `https://wa.me/${phone || '5531998587817'}${
        message ? `?text=${message}` : ''
      }`;
    }, 300);
  }, []);

  return (
    <>
      <Seo
        title="Redirecionando para WhatsApp | Joao Victor Souza"
        description="Pagina utilitaria de redirecionamento para WhatsApp."
        canonical="/whatsapp"
        robots="noindex,follow"
      />
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
    </>
  );
};

export default Wpp;
