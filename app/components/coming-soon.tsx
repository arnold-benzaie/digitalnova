export function ComingSoon({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-pm-gris-2 bg-white p-8">
      <p className="font-serif text-xl font-semibold text-pm-noir">{title}</p>
      <p className="mt-2 text-sm text-pm-gris">{description}</p>
    </div>
  );
}
