interface PlaceholderPageProps {
  title: string
  description: string
}

export function PlaceholderPage({ title, description }: PlaceholderPageProps) {
  return (
    <div>
      <h1 className="text-xl font-semibold">{title}</h1>
      <div className="mt-8 flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}
