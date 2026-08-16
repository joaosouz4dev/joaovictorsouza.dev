import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { localizedPath, toRouteLanguage } from '../config/routes';

/**
 * Devolve um gerador de caminhos ja no idioma ativo, para os links internos
 * apontarem para /about em ingles e /acerca-de em espanhol sem cada componente
 * precisar saber o idioma.
 *
 * const path = useLocalizedPath();
 * path('contact')                       // '/contacto'
 * path('service', 'whatsapp-cloud-api') // '/servicios/whatsapp-cloud-api'
 */
export const useLocalizedPath = () => {
  const { i18n } = useTranslation();
  const language = toRouteLanguage(i18n.resolvedLanguage || i18n.language);

  return useCallback(
    (routeKey, slug) => localizedPath(routeKey, language, slug),
    [language],
  );
};

export default useLocalizedPath;
