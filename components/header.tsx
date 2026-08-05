import Link from "next/link";

export default function Header() {
  return (
    <header className="sticky top-0 z-40 bg-slate-700">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4">
        <Link href="/" className="text-xl font-bold italic text-white">
          SaveTube
        </Link>
      </div>
    </header>
  );
}
