import React from 'react';
import { useParams } from 'react-router-dom';
import Seo from '../../components/seo';
import SiteLayout from '../../components/siteLayout';
import PageHero from '../../components/ui/PageHero';
import Section from '../../components/ui/Section';
import Container from '../../components/ui/Container';
import { RevealOnScroll } from '../../components/ui/RevealOnScroll';

const Privacidade = () => {
  const { title } = useParams();
  const displayTitle = title ? ` — ${title}` : '';

  return (
    <SiteLayout>
      <Seo
        title={`Política de Privacidade${displayTitle}`}
        description="Política de privacidade."
        canonical={`/politica-de-privacidade/${title || ''}`}
        robots="noindex,follow"
      />

      <PageHero
        eyebrow="Privacidade"
        title={`Política de Privacidade${displayTitle}`}
        description="Como tratamos seus dados pessoais e de localização."
      />

      <Section bordered>
        <Container size="sm">
          <RevealOnScroll>
            <article className="prose prose-invert max-w-none">
              <p>
                A sua privacidade é importante para nós. É política do <strong>{title || 'serviço'}</strong> respeitar a sua privacidade em relação a qualquer informação sua que possamos coletar no aplicativo.
              </p>
              <p>
                Solicitamos informações pessoais apenas quando realmente precisamos delas para lhe fornecer um serviço. Fazemo-lo por meios justos e legais, com o seu conhecimento e consentimento. Também informamos por que estamos coletando e como será usado.
              </p>
              <p>
                Apenas retemos as informações coletadas pelo tempo necessário para fornecer o serviço solicitado.
              </p>
              <p>
                Não compartilhamos informações de identificação pessoal publicamente ou com terceiros, exceto quando exigido por lei.
              </p>
              <p>
                Você é livre para recusar a nossa solicitação de informações pessoais, entendendo que talvez não possamos fornecer alguns dos serviços desejados.
              </p>

              <h2>Localização</h2>
              <p>
                Pegamos sua localização para preencher em nosso sistema o endereço no qual você se encontra. Com o intuito de agilizar a utilização do nosso serviço.
              </p>

              <h2>Mais informações</h2>
              <p>
                Sua localização é usada somente quando se abre a tela do aplicativo. Não armazenamos esses dados em nossos servidores.
              </p>

              <p>
                Esta política é efetiva a partir de <strong>Maio/2021</strong>.
              </p>
            </article>
          </RevealOnScroll>
        </Container>
      </Section>
    </SiteLayout>
  );
};

export default Privacidade;
