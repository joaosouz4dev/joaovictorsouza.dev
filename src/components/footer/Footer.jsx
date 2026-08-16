import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowUpRight } from 'lucide-react';
import { GitHub, LinkedIn, Instagram } from '../ui/SocialIcons';
import Container from '../ui/Container';
import GradientText from '../ui/GradientText';
import GlowEffect from '../ui/GlowEffect';
import LanguageSwitcher from '../ui/LanguageSwitcher';
import { getPublishedPosts } from '../../pages/blog/data.js';
import { useLocalizedPath } from '../../utils/useLocalizedPath';

const SOCIAL = [
  { href: 'https://github.com/joaosouz4dev', icon: GitHub, key: 'layout.social.github' },
  { href: 'https://www.linkedin.com/in/joaosouz4dev/', icon: LinkedIn, key: 'layout.social.linkedin' },
  { href: 'https://www.instagram.com/joaosouz4dev', icon: Instagram, key: 'layout.social.instagram' },
];

const Footer = () => {
  const { t, i18n } = useTranslation();
  const path = useLocalizedPath();
  const latestPosts = [...getPublishedPosts(i18n.language)]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 4);
  return (
    <footer className="relative isolate overflow-hidden border-t border-border/40 mt-20 md:mt-32">
      <GlowEffect intensity="xl" color="primary" className="-bottom-40 left-1/2 -translate-x-1/2 opacity-40" />
      <Container size="lg" className="relative py-16 md:py-24">
        <div className="grid grid-cols-1 gap-12 md:grid-cols-12 md:gap-8">
          <div className="md:col-span-5">
            <Link to="/" className="inline-flex items-center gap-3" aria-label="João Victor Souza">
              <img
                src="/assets/images/Logo.svg"
                alt=""
                aria-hidden="true"
                width="40"
                height="40"
                className="h-10 w-10 object-contain"
              />
              <span className="font-display text-lg font-medium tracking-tight">
                joaovictorsouza.dev
              </span>
            </Link>
            <p className="mt-6 max-w-md text-muted-foreground text-balance">
              {t('layout.footer.description')}
            </p>
            <Link
              to={path('contact')}
              className="group mt-8 inline-flex items-center gap-2 rounded-full border border-border/80 bg-surface/60 px-5 py-3 text-sm font-medium text-foreground backdrop-blur-xl transition-colors hover:border-foreground/30"
            >
              <GradientText>{t('layout.footer.cta')}</GradientText>
              <ArrowUpRight size={16} className="text-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </Link>
          </div>

          <div className="md:col-span-3">
            <h4 className="font-mono text-eyebrow uppercase text-muted-foreground mb-5">
              {t('layout.footer.quickNav')}
            </h4>
            <ul className="space-y-3 text-sm">
              <li>
                <Link to={path('service', 'whatsapp-cloud-api')} className="text-foreground/80 hover:text-foreground transition-colors">
                  WhatsApp Cloud API
                </Link>
              </li>
              <li>
                <Link to={path('service', 'meta-ads-e-integracoes')} className="text-foreground/80 hover:text-foreground transition-colors">
                  Meta Pixel + CAPI
                </Link>
              </li>
              <li>
                <Link to={path('post', 'guia-whatsapp-cloud-api')} className="text-foreground/80 hover:text-foreground transition-colors">
                  {t('layout.footer.mainGuide')}
                </Link>
              </li>
              <li>
                <Link to={path('cases')} className="text-foreground/80 hover:text-foreground transition-colors">
                  {t('layout.footer.viewAllCases')}
                </Link>
              </li>
            </ul>
          </div>

          <div className="md:col-span-4">
            <h4 className="font-mono text-eyebrow uppercase text-muted-foreground mb-5">
              {t('layout.footer.latestPosts')}
            </h4>
            <ul className="space-y-3 text-sm">
              {latestPosts.map((post) => (
                <li key={post.slug}>
                  <Link
                    to={path('post', post.slug)}
                    className="text-foreground/80 hover:text-foreground transition-colors line-clamp-2"
                  >
                    {post.title}
                  </Link>
                </li>
              ))}
            </ul>

            <h4 className="font-mono text-eyebrow uppercase text-muted-foreground mt-10 mb-5">
              {t('menu.contact')}
            </h4>
            <div className="space-y-3 text-sm">
              <a
                href="mailto:web@joaovictorsouza.dev"
                className="inline-flex items-center gap-2 text-foreground/80 hover:text-foreground transition-colors"
              >
                web@joaovictorsouza.dev
              </a>
              <a
                href="https://wa.me/5531998587817"
                target="_blank"
                rel="noopener noreferrer"
                className="block text-foreground/80 hover:text-foreground transition-colors"
              >
                {t('layout.footer.whatsappDirect')}
              </a>
            </div>

            <div className="mt-6 flex items-center gap-3">
              {SOCIAL.map(({ href, icon: Icon, key }) => (
                <a
                  key={href}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={t(key)}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border/60 bg-surface/40 text-foreground/70 backdrop-blur transition-all hover:text-foreground hover:border-foreground/30 hover:-translate-y-0.5"
                >
                  <Icon size={16} />
                </a>
              ))}
              <LanguageSwitcher className="ml-auto" align="right" />
            </div>
          </div>
        </div>

        <div className="mt-16 flex flex-col items-start justify-between gap-4 border-t border-border/40 pt-8 text-xs text-muted-foreground md:flex-row md:items-center">
          <p>© 2015 – {new Date().getFullYear()} João Victor Souza</p>
          <p className="flex flex-wrap items-center gap-3">
            <Link to="/" className="hover:text-foreground transition-colors">{t('menu.home')}</Link>
            <span className="text-foreground/20">/</span>
            <Link to={path('services')} className="hover:text-foreground transition-colors">{t('menu.services')}</Link>
            <span className="text-foreground/20">/</span>
            <Link to={path('blog')} className="hover:text-foreground transition-colors">{t('menu.blog')}</Link>
            <span className="text-foreground/20">/</span>
            <Link to={path('projects')} className="hover:text-foreground transition-colors">{t('menu.projects')}</Link>
          </p>
        </div>
      </Container>
    </footer>
  );
};

export default Footer;
