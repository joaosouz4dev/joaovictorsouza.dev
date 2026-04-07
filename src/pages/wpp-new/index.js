import React from 'react';
import WhatsAppForm from '../../components/WhatsAppForm';
import Seo from '../../components/seo';

const WhatsAppPage = () => {
  return (
    <>
      <Seo
        title="Gerador de link WhatsApp | Joao Victor Souza"
        description="Ferramenta utilitaria para iniciar conversa no WhatsApp."
        canonical="/wpp"
        robots="noindex,follow"
      />
      <div className="whatsapp-page-container">
        <WhatsAppForm />
      </div>
    </>
  );
};

export default WhatsAppPage; 
