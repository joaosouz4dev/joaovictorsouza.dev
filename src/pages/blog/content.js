import { toBaseLanguage } from '../../utils/i18n.js';
import { getPostContentBySlug } from './posts/index.js';

export const getPostContent = (slug, language = 'pt') =>
  getPostContentBySlug(slug, toBaseLanguage(language));
