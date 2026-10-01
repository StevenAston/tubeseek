import type { Metadata } from "next";
import Link from "next/link";
import { DM_Sans, Space_Mono } from "next/font/google";
import "./globals.css";

const sans = DM_Sans({ subsets: ["latin"], variable: "--font-dm-sans" });
const mono = Space_Mono({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-space-mono" });

export const metadata: Metadata = { title: "tubeseek", description: "Your own YouTube recommendations" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html lang="en" className={`${sans.variable} ${mono.variable}`}>
			<body className="font-sans antialiased">
				<header className="border-b-4 border-border bg-secondary text-secondary-foreground px-6 py-4 flex items-center justify-between">
					<Link href="/" className="font-mono text-3xl font-bold tracking-tight">TUBESEEK_</Link>
					<nav className="flex gap-6 font-mono font-bold">
						<Link href="/rank" className="hover:underline">RANK</Link>
						<Link href="/log" className="hover:underline">LOG</Link>
					</nav>
				</header>
				<main className="mx-auto max-w-5xl p-6 space-y-10">{children}</main>
			</body>
		</html>
	);
}
