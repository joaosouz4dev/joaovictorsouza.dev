import React from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Github, ArrowUpRight } from 'lucide-react';
import Seo from '../../components/seo';
import SiteLayout from '../../components/siteLayout';
import PageHero from '../../components/ui/PageHero';
import Section from '../../components/ui/Section';
import Card from '../../components/ui/Card';
import Button from '../../components/ui/Button';
import { RevealOnScroll } from '../../components/ui/RevealOnScroll';
import { getProjectBySlug } from '../projetos/data';

const Projeto = () => {
  const { t, i18n } = useTranslation();
  const { slug } = useParams();
  const project = getProjectBySlug(slug, i18n.resolvedLanguage);

  if (!project) {
    return (
      <SiteLayout>
        <Seo
          title={t('projectPage.notFoundSeoTitle')}
          description={t('projectPage.notFoundSeoDescription')}
          canonical="/projetos"
          robots="noindex,follow"
        />
        <PageHero
          eyebrow="404"
          title={t('projectPage.notFoundTitle')}
          description={t('projectPage.notFoundDescription')}
        >
          <Button to="/projetos" variant="outline">{t('menu.projects')}</Button>
        </PageHero>
      </SiteLayout>
    );
  }

  const schema = [
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareSourceCode',
      name: project.title,
      codeRepository: project.repository,
      description: project.summary,
      programmingLanguage: project.stack,
    },
  ];

  return (
    <SiteLayout>
      <Seo
        title={`${project.title} | Projeto técnico`}
        description={project.summary}
        canonical={`/projetos/${project.slug}`}
        schema={schema}
      />

      <PageHero
        eyebrow={t('projectPage.kicker')}
        title={project.title}
        description={project.summary}
      />

      <Section bordered>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <RevealOnScroll>
            <Card className="h-full p-8">
              <h2 className="font-mono text-eyebrow uppercase text-muted-foreground mb-5">
                {t('projectPage.stackTitle')}
              </h2>
              <div className="flex flex-wrap gap-2">
                {project.stack.map((s) => (
                  <span key={s} className="rounded-full border border-border/60 bg-surface/40 px-3 py-1 text-xs text-foreground/80">
                    {s}
                  </span>
                ))}
              </div>
            </Card>
          </RevealOnScroll>
          <RevealOnScroll delay={0.1}>
            <Card spotlight className="h-full p-8">
              <h2 className="font-mono text-eyebrow uppercase text-muted-foreground mb-5">
                {t('projectPage.repositoryTitle')}
              </h2>
              <a
                href={project.repository}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-foreground hover:text-primary-400 transition-colors break-all"
              >
                <Github size={16} />
                {project.repository}
              </a>
              <Button to="/contato" className="mt-6 w-full" rightIcon={<ArrowUpRight size={16} />}>
                {t('projectPage.cta')}
              </Button>
            </Card>
          </RevealOnScroll>
        </div>
      </Section>
    </SiteLayout>
  );
};

export default Projeto;
