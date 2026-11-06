import React from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Seo from '../../components/seo';
import SiteLayout from '../../components/siteLayout';
import PageHero from '../../components/ui/PageHero';
import Section from '../../components/ui/Section';
import Container from '../../components/ui/Container';
import { RevealOnScroll } from '../../components/ui/RevealOnScroll';

const CONTACT_EMAIL = 'web@joaovictorsouza.dev';

// O segmento opcional da URL nomeia o app (/politica-de-privacidade/Nubi).
// A politica e a mesma para todos os apps; o nome so personaliza o texto.
const appNameFrom = (param) => {
  if (!param) return '';
  try {
    return decodeURIComponent(param).replace(/[-_]+/g, ' ').trim();
  } catch {
    return param;
  }
};

const Privacidade = () => {
  const { title } = useParams();
  const { t } = useTranslation();
  const appName = appNameFrom(title);
  const displayTitle = appName ? ` · ${appName}` : '';
  const list = (key) => t(key, { returnObjects: true });

  return (
    <SiteLayout>
      <Seo
        title={`${t('privacy.seoTitle')}${displayTitle}`}
        description={t('privacy.seoDescription')}
        canonical={`/politica-de-privacidade/${title || ''}`}
        robots="noindex,follow"
      />

      <PageHero
        eyebrow={t('privacy.eyebrow')}
        title={`${t('privacy.title')}${displayTitle}`}
        description={t('privacy.description')}
      />

      <Section bordered>
        <Container size="sm">
          <RevealOnScroll>
            <article className="prose prose-invert max-w-none">
              <p>
                {t('privacy.updatedLabel')} <strong>{t('privacy.updatedDate')}</strong>
              </p>
              <p>{t('privacy.intro', { app: appName || t('privacy.appFallback') })}</p>

              <h2>{t('privacy.collectTitle')}</h2>
              <p>{t('privacy.collectText')}</p>

              <h2>{t('privacy.deviceTitle')}</h2>
              <p>{t('privacy.deviceText')}</p>
              <ul>
                {list('privacy.deviceItems').map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>

              <h2>{t('privacy.networkTitle')}</h2>
              <ul>
                {list('privacy.networkItems').map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>

              <h2>{t('privacy.permissionsTitle')}</h2>
              <p>{t('privacy.permissionsText')}</p>

              <h2>{t('privacy.childrenTitle')}</h2>
              <p>{t('privacy.childrenText')}</p>

              <h2>{t('privacy.changesTitle')}</h2>
              <p>{t('privacy.changesText')}</p>

              <h2>{t('privacy.contactTitle')}</h2>
              <p>
                {t('privacy.contactText')} <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
              </p>
            </article>
          </RevealOnScroll>
        </Container>
      </Section>
    </SiteLayout>
  );
};

export default Privacidade;
