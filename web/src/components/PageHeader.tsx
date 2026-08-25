export default function PageHeader({
  title,
  subtitle,
}: {
  title: string
  subtitle: string
}) {
  return (
    <header className="mb-6">
      <h1 className="font-display text-3xl font-black uppercase tracking-tight text-chalk sm:text-4xl">
        {title}
      </h1>
      <div className="checker-rule mt-3 w-24" />
      <p className="mt-3 text-sm text-haze">{subtitle}</p>
    </header>
  )
}
