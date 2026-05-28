import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MessageCircle, ArrowUpRight } from 'lucide-react';
import Card from '../ui/Card';
import Button from '../ui/Button';

const WhatsAppForm = () => {
  const { t } = useTranslation();
  const [phoneNumber, setPhoneNumber] = useState('');
  const [message, setMessage] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    const cleanPhone = phoneNumber.replace(/\D/g, '');
    const encodedMessage = encodeURIComponent(message);
    const isMobile = window.innerWidth < 768;
    const whatsappUrl = isMobile
      ? `whatsapp://send/?phone=${cleanPhone}&text=${encodedMessage}`
      : `https://wa.me/${cleanPhone}?text=${encodedMessage}`;
    window.open(whatsappUrl, '_blank');
  };

  return (
    <Card spotlight className="mx-auto max-w-xl p-8">
      <div className="mb-6 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-accent text-white shadow-glow">
        <MessageCircle size={20} />
      </div>
      <h2 className="font-display text-h2 font-medium tracking-tight">
        {t('whatsapp.title', 'Enviar mensagem WhatsApp')}
      </h2>
      <p className="mt-2 text-muted-foreground">
        Gere um link <code className="font-mono text-xs">wa.me</code> para iniciar uma conversa sem
        salvar o contato.
      </p>
      <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
        <div>
          <label className="font-mono text-eyebrow uppercase text-muted-foreground" htmlFor="phone">
            Telefone
          </label>
          <input
            id="phone"
            type="tel"
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, ''))}
            placeholder={t('whatsapp.phonePlaceholder', '5531998587817')}
            required
            className="mt-2 w-full rounded-2xl border border-border/60 bg-surface/40 px-4 py-3 text-foreground placeholder:text-muted-foreground focus:border-foreground/40 focus:outline-none focus:ring-0"
          />
        </div>
        <div>
          <label className="font-mono text-eyebrow uppercase text-muted-foreground" htmlFor="msg">
            Mensagem
          </label>
          <textarea
            id="msg"
            rows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t('whatsapp.messagePlaceholder', 'Olá! Gostaria de conversar sobre...')}
            className="mt-2 w-full rounded-2xl border border-border/60 bg-surface/40 px-4 py-3 text-foreground placeholder:text-muted-foreground focus:border-foreground/40 focus:outline-none focus:ring-0"
          />
        </div>
        <Button as="button" type="submit" disabled={!phoneNumber} size="lg" rightIcon={<ArrowUpRight size={18} />} className="w-full">
          {t('whatsapp.sendButton', 'Abrir WhatsApp')}
        </Button>
      </form>
    </Card>
  );
};

export default WhatsAppForm;
