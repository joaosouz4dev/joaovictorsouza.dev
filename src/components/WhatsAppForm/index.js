import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';

const WhatsAppForm = () => {
  const { t } = useTranslation();
  const [phoneNumber, setPhoneNumber] = useState('');
  const [message, setMessage] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    
    // Remove any non-numeric characters from phone number
    const cleanPhone = phoneNumber.replace(/\D/g, '');
    
    // Encode the message for URL
    const encodedMessage = encodeURIComponent(message);
    
    // Check if screen width is less than 768px (mobile)
    const isMobile = window.innerWidth < 768;
    
    // Create WhatsApp URL based on device type
    let whatsappUrl;
    if (isMobile) {
      // Use whatsapp:// protocol for mobile devices
      whatsappUrl = `whatsapp://send/?phone=${cleanPhone}&text=${encodedMessage}`;
    } else {
      // Use https://wa.me/ for desktop devices
      whatsappUrl = `https://wa.me/${cleanPhone}?text=${encodedMessage}`;
    }
    
    // Open WhatsApp
    window.open(whatsappUrl, '_blank');
  };

  const handlePhoneChange = (e) => {
    // Allow only numbers and basic formatting
    const value = e.target.value.replace(/\D/g, '');
    setPhoneNumber(value);
  };

  return (
    <div className="whatsapp-form-container">
      <h2 className="whatsapp-form-title">{t('whatsapp.title', 'Send WhatsApp Message')}</h2>
      <form className="whatsapp-form" onSubmit={handleSubmit}>
        <input
          type="tel"
          className="whatsapp-form-input"
          value={phoneNumber}
          onChange={handlePhoneChange}
          placeholder={t('whatsapp.phonePlaceholder', 'Phone number (with country code)')}
          required
        />
        <textarea
          className="whatsapp-form-textarea"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={t('whatsapp.messagePlaceholder', 'Type your message here...')}
        />
        <button 
          type="submit" 
          className="whatsapp-form-button"
          disabled={!phoneNumber}
        >
          {t('whatsapp.sendButton', 'Send Message')}
        </button>
      </form>
    </div>
  );
};

export default WhatsAppForm; 