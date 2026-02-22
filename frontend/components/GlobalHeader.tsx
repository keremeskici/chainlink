import Link from 'next/link';
import { ConnectButton } from '@rainbow-me/rainbowkit';

export function GlobalHeader() {
    return (
        <header className="fixed top-0 w-full h-16 border-b border-white flex items-center justify-between px-6 bg-black z-50">
            <nav className="flex gap-8">
                <Link href="/markets" className="text-white transition-colors hover:text-green font-mono text-lg uppercase tracking-wider">
                    [Markets]
                </Link>
                <Link href="/delegate" className="text-white transition-colors hover:text-green font-mono text-lg uppercase tracking-wider">
                    [Delegate]
                </Link>
            </nav>
            <div className="brutalist-connect">
                <ConnectButton />
            </div>
        </header>
    );
}
