import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

const WhatsAppForm = () => {
  const { t } = useTranslation();
  const [phoneNumber, setPhoneNumber] = useState('');
  const [message, setMessage] = useState('');

  const cleanPhone = phoneNumber.replace(/\D/g, '');
  const encodedMessage = encodeURIComponent(message);
  const whatsappUrl = `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodedMessage}`;

  const handlePhoneChange = (e) => {
    // Allow only numbers and basic formatting
    const value = e.target.value.replace(/\D/g, '');
    setPhoneNumber(value);
  };

  return (
    <div className="whatsapp-form-container">
      <h2 className="whatsapp-form-title">
        {t('whatsapp.title', 'Send WhatsApp Message')}
      </h2>
      <form className="whatsapp-form">
        <input
          type="tel"
          className="whatsapp-form-input"
          value={phoneNumber}
          onChange={handlePhoneChange}
          placeholder={t(
            'whatsapp.phonePlaceholder',
            'Phone number (with country code)',
          )}
          required
        />
        <textarea
          className="whatsapp-form-textarea"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={t(
            'whatsapp.messagePlaceholder',
            'Type your message here...',
          )}
        />
        <a
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="whatsapp-form-button"
          disabled={!phoneNumber}
        >
          {t('whatsapp.sendButton', 'Send Message')}
        </a>
      </form>
    </div>
  );
};

export default WhatsAppForm;
