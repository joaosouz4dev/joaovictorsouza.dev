import { useState, useRef, useEffect } from 'react';
import i18next from 'i18next';
import { toBaseLanguage } from '../../utils/i18n';

const LanguageSelector = () => {
  const [selectedLanguage, setSelectedLanguage] = useState(
    toBaseLanguage(i18next.resolvedLanguage || i18next.language),
  );
  const [isOpen, setIsOpen] = useState(false);
  const [isInFooter, setIsInFooter] = useState(false);
  const dropdownRef = useRef(null);
  const triggerRef = useRef(null);

  const languages = [
    { code: 'en', name: 'English', flag: '🇺🇸' },
    { code: 'es', name: 'Español', flag: '🇪🇸' },
    { code: 'pt', name: 'Português', flag: '🇧🇷' }
  ];

  const currentLanguage = languages.find(lang =>
    lang.code === toBaseLanguage(selectedLanguage)
  );

  const changeLanguage = (lng) => {
    i18next.changeLanguage(lng);
    setSelectedLanguage(toBaseLanguage(lng));
    setIsOpen(false);
  };

  useEffect(() => {
    const handleLanguageChange = (lng) => {
      setSelectedLanguage(toBaseLanguage(lng));
    };

    i18next.on('languageChanged', handleLanguageChange);

    return () => {
      i18next.off('languageChanged', handleLanguageChange);
    };
  }, []);

  // Detectar se está no footer
  useEffect(() => {
    const checkPosition = () => {
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        const windowHeight = window.innerHeight;
        const elementCenter = rect.top + rect.height / 2;
        
        // Se o elemento está na metade inferior da tela, está no footer
        setIsInFooter(elementCenter > windowHeight / 2);
      }
    };

    checkPosition();
    window.addEventListener('resize', checkPosition);
    window.addEventListener('scroll', checkPosition);

    return () => {
      window.removeEventListener('resize', checkPosition);
      window.removeEventListener('scroll', checkPosition);
    };
  }, []);

  // Fechar dropdown quando clicar fora
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  return (
    <div className="language-selector" ref={dropdownRef}>
      <div 
        ref={triggerRef}
        className={`language-selector__trigger ${isOpen ? 'active' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="language-selector__flag">{currentLanguage?.flag}</span>
        <span className="language-selector__text">{currentLanguage?.name}</span>
        <svg 
          className={`language-selector__arrow ${isOpen ? 'rotated' : ''}`}
          width="10" 
          height="10" 
          viewBox="0 0 24 24" 
          fill="none" 
          stroke="currentColor" 
          strokeWidth="2"
        >
          <polyline points="6,9 12,15 18,9"></polyline>
        </svg>
      </div>
      
      {isOpen && (
        <div className={`language-selector__dropdown ${isInFooter ? 'dropdown-up' : 'dropdown-down'}`}>
          {languages.map((language) => (
            <div
              key={language.code}
              className={`language-selector__option ${
                language.code === currentLanguage?.code ? 'selected' : ''
              }`}
              onClick={() => changeLanguage(language.code)}
            >
              <span className="language-selector__flag">{language.flag}</span>
              <span className="language-selector__text">{language.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default LanguageSelector;
