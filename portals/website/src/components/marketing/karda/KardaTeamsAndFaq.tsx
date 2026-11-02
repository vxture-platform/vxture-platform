/**
 * Team use cases, accessible FAQ and invitation call to action.
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 * @author AI-Generated
 * @date 2026-11-02
 */
import { useTranslations } from "next-intl";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Button,
  Card,
  Icon,
} from "@vxture/design-system";
import type { IconName } from "@vxture/design-system";
import { Link } from "@/lib/i18n/navigation";
import { KardaSectionIntro } from "./KardaSectionIntro";

const TEAM_ICONS: IconName[] = ["code", "stack", "search"];
interface Team {
  role: string;
  title: string;
  description: string;
  result: string;
}
interface Question {
  question: string;
  answer: string;
}

// Page sections
/** @returns Team scenarios, FAQ and the invitation-only contact action. */
export function KardaTeamsAndFaq() {
  const t = useTranslations("products.karda");
  return (
    <>
      <section
        aria-labelledby="karda-teams-title"
        className="border-y border-border bg-muted/20 py-16 lg:py-24"
      >
        <div className="mx-auto max-w-page-xl px-6 lg:px-8 xl:max-w-page-2xl">
          <KardaSectionIntro
            id="karda-teams-title"
            eyebrow={t("teams.eyebrow")}
            title={t("teams.title")}
            description={t("teams.description")}
          />
          <div className="grid gap-5 md:grid-cols-3">
            {(t.raw("teams.items") as Team[]).map((team, index) => (
              <Card key={team.role} className="h-full gap-0 p-6 lg:p-8">
                <Icon
                  name={TEAM_ICONS[index] ?? "stack"}
                  className="mb-7 h-8 w-8 text-primary-text"
                  aria-hidden
                />
                <p className="text-label-sm text-muted-foreground">
                  {team.role}
                </p>
                <h3 className="font-display mb-4 mt-3 text-2xl font-semibold leading-snug text-balance">
                  {team.title}
                </h3>
                <p className="mb-6 text-body-md leading-7 text-muted-foreground">
                  {team.description}
                </p>
                <p className="mt-auto flex items-start gap-2 border-t border-border pt-5 text-body-sm text-primary-text">
                  <Icon
                    name="arrow-right"
                    className="mt-1 h-4 w-4 shrink-0"
                    aria-hidden
                  />
                  {team.result}
                </p>
              </Card>
            ))}
          </div>
        </div>
      </section>
      <section
        aria-labelledby="karda-faq-title"
        className="pb-10 pt-16 lg:pt-24"
      >
        <div className="mx-auto grid max-w-page-xl gap-8 px-6 lg:grid-cols-5 lg:gap-16 lg:px-8 xl:max-w-page-2xl">
          <div className="lg:col-span-2">
            <KardaSectionIntro
              id="karda-faq-title"
              eyebrow={t("faq.eyebrow")}
              title={t("faq.title")}
              description={t("faq.description")}
            />
          </div>
          <Accordion
            type="single"
            collapsible
            defaultValue="question-0"
            className="min-w-0 lg:col-span-3"
          >
            {(t.raw("faq.items") as Question[]).map((item, index) => (
              <AccordionItem key={item.question} value={`question-${index}`}>
                <AccordionTrigger className="py-5 text-left text-base">
                  {item.question}
                </AccordionTrigger>
                <AccordionContent className="text-body-md leading-7 text-muted-foreground">
                  {item.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </section>
      <section aria-labelledby="karda-cta-title" className="pb-16">
        <div className="mx-auto max-w-page-xl px-6 lg:px-8 xl:max-w-page-2xl">
          <Card className="gap-8 border-primary-border bg-primary-muted p-8 lg:flex-row lg:items-center lg:justify-between lg:p-12">
            <div>
              <p className="text-label-sm font-semibold text-primary-text">
                {t("cta.eyebrow")}
              </p>
              <h2
                id="karda-cta-title"
                className="font-display mt-4 text-3xl font-semibold leading-snug text-balance"
              >
                {t("cta.title")}
              </h2>
              <p className="mt-4 text-base leading-7 text-muted-foreground">
                {t("cta.description")}
              </p>
            </div>
            <div className="shrink-0">
              <Button asChild size="xl">
                <Link href="/contact#support">
                  {t("hero.primaryAction")}
                  <Icon name="arrow-right" className="h-4 w-4" aria-hidden />
                </Link>
              </Button>
              <p className="mt-3 text-label-sm text-muted-foreground">
                {t("cta.note")}
              </p>
            </div>
          </Card>
        </div>
      </section>
    </>
  );
}
