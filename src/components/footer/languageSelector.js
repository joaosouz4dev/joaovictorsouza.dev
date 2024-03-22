import { useState } from 'react';
import i18next from 'i18next';

const LanguageSelector = () => {
  const [selectedLanguage, setSelectedLanguage] = useState(i18next.language);

  const changeLanguage = (lng) => {
    i18next.changeLanguage(lng);
    setSelectedLanguage(lng);
  };

  return (
    <div>
      <select
        id="language-select"
        value={selectedLanguage === 'pt-BR' ? 'pt' : selectedLanguage}
        onChange={(e) => changeLanguage(e.target.value)}
      >
        <option value="en">English</option>
        <option value="pt">Português</option>
      </select>
    </div>
  );
};

export default LanguageSelector;
