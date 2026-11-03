/**
 * Purchase-relevant boundaries and a real contact action rather than a fake download.
 * @package @vxture/website
 * @layer Presentation
 * @category Components - Marketing
 * @author AI-Generated
 * @date 2026-11-03
 */
import { useTranslations } from "next-intl";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
  Button,
  Icon,
} from "@vxture/design-system";
import { Link } from "@/lib/i18n/navigation";

// Section composition
/** @returns Frequently asked questions and a scoped product-experience invitation. */
export function WorkbenchFaq() {
  const t = useTranslations("products.workbench");
  const questions = t.raw("faq.items") as {
    question: string;
    answer: string;
  }[];
  return (
    <>
      <section
        aria-labelledby="workbench-faq-title"
        className="border-t border-border py-16 lg:py-20"
      >
        <div className="mx-auto grid max-w-page-xl gap-8 px-6 lg:grid-cols-12 lg:gap-16 lg:px-8 xl:max-w-page-2xl">
          <div className="lg:col-span-4">
            <p className="text-label-sm font-semibold tracking-widest text-primary-text">
              {t("faq.eyebrow")}
            </p>
            <h2
              id="workbench-faq-title"
              className="font-display mt-4 text-3xl font-semibold leading-snug"
            >
              {t("faq.title")}
            </h2>
          </div>
          <Accordion type="single" collapsible className="lg:col-span-8">
            {questions.map((item, i) => (
              <AccordionItem key={item.question} value={`faq-${i}`}>
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
      <section aria-labelledby="workbench-cta-title" className="pb-16 lg:pb-24">
        <div className="mx-auto max-w-page-xl px-6 lg:px-8 xl:max-w-page-2xl">
          <div className="relative overflow-hidden rounded-xl border border-primary-border bg-linear-to-br from-primary-muted to-background p-7 sm:p-10 lg:p-14">
            <p className="text-label-sm font-semibold tracking-widest text-primary-text">
              RUYIN / INTELLIGENT WORKBENCH
            </p>
            <div className="mt-5 flex flex-col gap-7 lg:flex-row lg:items-end lg:justify-between lg:gap-16">
              <div className="max-w-website-3xl">
                <h2
                  id="workbench-cta-title"
                  className="font-display text-3xl font-semibold leading-snug tracking-tight text-balance lg:text-4xl"
                >
                  {t("cta.title")}
                </h2>
                <p className="mt-5 text-base leading-8 text-muted-foreground">
                  {t("cta.description")}
                </p>
              </div>
              <Button asChild size="lg" className="self-start lg:shrink-0">
                <Link href="/contact#support">
                  {t("hero.primaryAction")}
                  <Icon name="arrow-right" className="h-4 w-4" aria-hidden />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
