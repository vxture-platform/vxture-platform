type FooterPlaceholderPageProps = {
  title: string;
};

export function FooterPlaceholderPage({ title }: FooterPlaceholderPageProps) {
  return (
    <section className="vx-section-odd flex min-h-screen text-vx-gray-900 dark:text-vx-gray-100">
      <div className="mx-auto flex w-full max-w-7xl flex-col items-center justify-center px-4 text-center sm:px-6 lg:px-8">
        <p className="text-sm font-semibold text-vx-brand-600 dark:text-vx-brand-300">
          {title}
        </p>
        <h1 className="font-display mt-4 text-4xl font-bold tracking-normal">
          开发中
        </h1>
        <p className="mt-4 max-w-website-xl text-sm leading-7 text-vx-gray-500 dark:text-vx-gray-400">
          当前板块正在建设中，完整内容将陆续上线。
        </p>
      </div>
    </section>
  );
}
