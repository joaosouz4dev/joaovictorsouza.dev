import React from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Seo from '../../components/seo';
import SiteLayout from '../../components/siteLayout';
import PageHero from '../../components/ui/PageHero';
import Section from '../../components/ui/Section';
import Container from '../../components/ui/Container';
import { RevealOnScroll } from '../../components/ui/RevealOnScroll';

const Privacidade = () => {
  const { title } = useParams();
  const { t } = useTranslation();
  const displayTitle = title ? ` · ${title}` : '';

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
                {t('privacy.p1Start')} <strong>{title || t('privacy.serviceFallback')}</strong>{' '}
                {t('privacy.p1End')}
              </p>
              <p>{t('privacy.p2')}</p>
              <p>{t('privacy.p3')}</p>
              <p>{t('privacy.p4')}</p>
              <p>{t('privacy.p5')}</p>

              <h2>{t('privacy.locationTitle')}</h2>
              <p>{t('privacy.locationText')}</p>

              <h2>{t('privacy.moreTitle')}</h2>
              <p>{t('privacy.moreText')}</p>

              <p>
                {t('privacy.effective')} <strong>{t('privacy.effectiveDate')}</strong>.
              </p>
            </article>
          </RevealOnScroll>
        </Container>
      </Section>
    </SiteLayout>
  );
};

export default Privacidade;
