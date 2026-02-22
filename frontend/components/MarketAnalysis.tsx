import { Market } from '@/app/actions/polymarket';

interface MarketAnalysisProps {
    market: Market;
    onInitiate: () => void;
    onBack: () => void;
    resolved?: string;
}

export function MarketAnalysis({ market, onInitiate, onBack, resolved }: MarketAnalysisProps) {
    return (
        <div className="p-6 max-w-4xl mx-auto mt-8 animate-in fade-in duration-500">
            <button
                onClick={onBack}
                className="text-gray-400 hover:text-white font-mono uppercase tracking-widest mb-8 transition-colors"
            >
                ← Back to Markets
            </button>

            <div className="border-l-4 border-white pl-6 mb-12">
                <div className="flex items-start justify-between gap-4">
                    <h1 className="text-3xl font-bold mb-4 text-white leading-tight">
                        {market.question}
                    </h1>
                    {resolved && (
                        <span className="shrink-0 border border-green text-green px-3 py-1 text-xs font-bold uppercase tracking-widest">
                            Resolved
                        </span>
                    )}
                </div>
                <div className="flex gap-6 font-mono text-sm text-gray-400">
                    <span>ID: {market.id}</span>
                    <span>Volume: {market.volume}</span>
                </div>
            </div>

            <div className="border border-white p-8 mb-8 bg-[#050505]">
                <h2 className="text-xl uppercase tracking-widest mb-6 border-b border-gray-800 pb-2">Event Rules &amp; Context</h2>
                <div
                    className="text-gray-300 font-mono text-sm leading-relaxed prose prose-invert"
                    dangerouslySetInnerHTML={{ __html: market.description || 'No specific rules provided for this event.' }}
                />
            </div>

            <div className="border border-white p-8 mb-12 bg-[#050505]">
                <h2 className="text-xl uppercase tracking-widest mb-6 border-b border-gray-800 pb-2">Possible Outcomes ({market.options.length})</h2>
                <div className="grid gap-3">
                    {market.options.map((option, i) => (
                        <div key={i} className="flex items-center gap-4 font-mono text-sm">
                            <span className="text-gray-600 w-6 text-right">{i + 1}.</span>
                            <span className={`border px-4 py-2 flex-1 bg-black ${resolved === option
                                    ? 'border-green text-green font-bold'
                                    : 'border-gray-800 text-white'
                                }`}>
                                {option}
                                {resolved === option && ' ✓'}
                            </span>
                        </div>
                    ))}
                </div>
            </div>

            {resolved ? (
                <div className="flex flex-col items-center gap-4">
                    <div className="border-2 border-green px-8 py-4 text-center">
                        <div className="text-gray-400 font-mono tracking-widest uppercase text-xs mb-2">
                            Verdict
                        </div>
                        <div className="text-green text-2xl font-bold tracking-wider">
                            {resolved}
                        </div>
                    </div>
                    <p className="font-mono text-xs text-gray-600 tracking-widest uppercase">
                        Already resolved via SwarmOracle consensus
                    </p>
                </div>
            ) : (
                <div className="flex flex-col items-center gap-4">
                    <button
                        onClick={onInitiate}
                        className="group relative inline-flex items-center justify-center px-12 py-6 font-bold text-white bg-black border-2 border-white uppercase tracking-[0.2em] hover:bg-white hover:text-black transition-all duration-300 w-full md:w-auto"
                    >
                        <span className="relative flex items-center gap-4">
                            <span className="w-3 h-3 bg-red group-hover:bg-black transition-colors" />
                            Initiate Consensus Protocol
                            <span className="w-3 h-3 bg-red group-hover:bg-black transition-colors" />
                        </span>
                    </button>
                </div>
            )}
        </div>
    );
}
