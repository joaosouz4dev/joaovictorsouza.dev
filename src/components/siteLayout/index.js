import React, { useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Home, User, Briefcase, FolderKanban, BookOpen, Mail, Sparkles, ChevronRight } from 'lucide-react';
import Container from '../ui/Container';
import LenisProvider from '../ui/LenisProvider';
import ScrollProgress from '../ui/ScrollProgress';
import Dock from '../ui/Dock';
import MobileMenu from '../ui/MobileMenu';
import ThemeToggle from '../ui/ThemeToggle';
import LanguageSwitcher from '../ui/LanguageSwitcher';
import Footer from '../footer/Footer';

const BREADCRUMB_LABEL_KEYS = {
  sobre: 'menu.about',
  servicos: 'menu.services',
  cases: 'menu.cases',
  blog: 'menu.blog',
  projetos: 'menu.projects',
  contato: 'menu.contact',
};

const NAV_ITEMS = (t) => [
  { to: '/', label: t('menu.home'), icon: <Home size={16} /> },
  { to: '/sobre', label: t('menu.about'), icon: <User size={16} /> },
  { to: '/servicos', label: t('menu.services'), icon: <Briefcase size={16} /> },
  { to: '/cases', label: t('menu.cases'), icon: <Sparkles size={16} /> },
  { to: '/blog', label: t('menu.blog'), icon: <BookOpen size={16} /> },
  { to: '/projetos', label: t('menu.projects'), icon: <FolderKanban size={16} /> },
  { to: '/contato', label: t('menu.contact'), icon: <Mail size={16} /> },
];

const SiteLayout = ({ children }) => {
  const { t } = useTranslation();
  const location = useLocation();
  const pathname = location.pathname || '/';
  const navItems = useMemo(() => NAV_ITEMS(t), [t]);

  const breadcrumbItems = pathname
    .split('/')
    .filter(Boolean)
    .map((segment, index, array) => {
      const href = `/${array.slice(0, index + 1).join('/')}`;
      return {
        href,
        label:
          (BREADCRUMB_LABEL_KEYS[segment] && t(BREADCRUMB_LABEL_KEYS[segment])) ||
          decodeURIComponent(segment)
            .replace(/-/g, ' ')
            .replace(/^\w/, (c) => c.toUpperCase()),
      };
    });

  return (
    <LenisProvider>
      <ScrollProgress />
      <div className="relative isolate min-h-screen flex flex-col">
        <div aria-hidden className="pointer-events-none fixed inset-0 -z-50 grid-bg opacity-30" />

        <header className="fixed inset-x-0 top-4 md:top-6 z-50 px-4">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
            <Link
              to="/"
              className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-surface/70 px-3 py-2 text-sm font-display font-medium tracking-tight backdrop-blur-2xl"
            >
              <span className="grid h-7 w-7 place-items-center rounded-full bg-gradient-accent text-white text-xs font-medium">
                JV
              </span>
              <span className="hidden md:inline">joaovictorsouza.dev</span>
            </Link>

            <div className="hidden md:block">
              <Dock items={navItems} />
            </div>

            <div className="flex items-center gap-2">
              <LanguageSwitcher className="hidden md:block" />
              <ThemeToggle />
              <MobileMenu items={navItems} className="md:hidden" ctaLabel={t('layout.footer.cta')} ctaHref="/contato" />
            </div>
          </div>
        </header>

        <main className="relative flex-1">
          {pathname !== '/' && breadcrumbItems.length > 0 && (
            <Container size="lg" className="pt-28 md:pt-32">
              <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs font-mono uppercase tracking-[0.16em] text-muted-foreground">
                <Link to="/" className="hover:text-foreground transition-colors">
                  {t('menu.home')}
                </Link>
                {breadcrumbItems.map((item, i) => (
                  <React.Fragment key={`${item.href}-${i}`}>
                    <ChevronRight size={12} className="text-foreground/30" />
                    <Link to={item.href} className="hover:text-foreground transition-colors">
                      {item.label}
                    </Link>
                  </React.Fragment>
                ))}
              </nav>
            </Container>
          )}
          {children}
        </main>

        <Footer />
      </div>
    </LenisProvider>
  );
};

export default SiteLayout;
