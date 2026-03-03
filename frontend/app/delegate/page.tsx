'use client';

import { useState, useMemo, useCallback } from 'react';
import { useAccount, useReadContract, useWriteContract } from 'wagmi';
import { formatUnits, parseUnits, maxUint256 } from 'viem';
import { SOP_VAULT_ADDRESS, SOP_VAULT_ABI, ERC20_ABI } from '@/lib/contracts';

export default function DelegatePage() {
    const { address } = useAccount();
    const [amount, setAmount] = useState('');
    const [mode, setMode] = useState<'stake' | 'unstake'>('stake');
    const [isPending, setIsPending] = useState(false);
    const [toast, setToast] = useState<{ msg: string; type: 'error' | 'success' } | null>(null);

    const showToast = useCallback((msg: string, type: 'error' | 'success' = 'error') => {
        setToast({ msg, type });
        setTimeout(() => setToast(null), 4000);
    }, []);

    // ── Contract Reads ──────────────────────────────────────────────

    const { data: umaTokenAddress } = useReadContract({
        address: SOP_VAULT_ADDRESS,
        abi: SOP_VAULT_ABI,
        functionName: 'umaToken',
    });

    const { data: rawTvl, refetch: refetchTvl } = useReadContract({
        address: SOP_VAULT_ADDRESS,
        abi: SOP_VAULT_ABI,
        functionName: 'getUmatvl',
    });

    const { data: rawApy } = useReadContract({
        address: SOP_VAULT_ADDRESS,
        abi: SOP_VAULT_ABI,
        functionName: 'getApy',
    });

    const { data: rawStakedBalance, refetch: refetchStakedBalance } = useReadContract({
        address: SOP_VAULT_ADDRESS,
        abi: SOP_VAULT_ABI,
        functionName: 'balances',
        args: address ? [address] : undefined,
        query: { enabled: !!address },
    });

    const { data: rawUmaBalance, refetch: refetchUmaBalance } = useReadContract({
        address: umaTokenAddress as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: address ? [address] : undefined,
        query: { enabled: !!address && !!umaTokenAddress },
    });

    const { data: rawAllowance, refetch: refetchAllowance } = useReadContract({
        address: umaTokenAddress as `0x${string}`,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: address && SOP_VAULT_ADDRESS ? [address, SOP_VAULT_ADDRESS] : undefined,
        query: { enabled: !!address && !!umaTokenAddress },
    });

    // ── Write Hooks ─────────────────────────────────────────────────

    const { writeContractAsync: writeApprove } = useWriteContract();
    const { writeContractAsync: writeStake } = useWriteContract();
    const { writeContractAsync: writeUnstake } = useWriteContract();

    // ── Display Formatting ──────────────────────────────────────────

    // TVL: formatUnits → no decimals
    const displayTvl = rawTvl !== undefined
        ? Math.floor(Number(formatUnits(rawTvl as bigint, 18))).toLocaleString()
        : '0';

    // APY: basis points → percentage
    const displayApy = rawApy !== undefined
        ? (Number(rawApy) / 100).toFixed(1) + '%'
        : '0%';

    const getExactBalance = (raw: unknown) => raw !== undefined ? formatUnits(raw as bigint, 18) : '0';

    const formatDisplayBalance = (raw: unknown) => {
        if (raw === undefined) return '0';
        const str = formatUnits(raw as bigint, 18);
        const [intPart, decPart] = str.split('.');
        if (!decPart) return intPart;
        const truncatedDec = decPart.slice(0, 5).replace(/0+$/, '');
        return truncatedDec ? `${intPart}.${truncatedDec}` : intPart;
    };

    const displayStakedBalance = useMemo(() => formatDisplayBalance(rawStakedBalance), [rawStakedBalance]);
    const umaBalance = useMemo(() => formatDisplayBalance(rawUmaBalance), [rawUmaBalance]);

    const exactStakedBalance = useMemo(() => getExactBalance(rawStakedBalance), [rawStakedBalance]);
    const exactUmaBalance = useMemo(() => getExactBalance(rawUmaBalance), [rawUmaBalance]);

    // ── Allowance Check ─────────────────────────────────────────────

    const needsApproval = useMemo(() => {
        if (mode !== 'stake') return false;
        if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) return false;
        try {
            const parsedAmount = parseUnits(amount, 18);
            const currentAllowance = rawAllowance as bigint | undefined;
            if (currentAllowance === undefined) return true;
            return currentAllowance < parsedAmount;
        } catch {
            return false;
        }
    }, [mode, amount, rawAllowance]);

    // ── Actions ─────────────────────────────────────────────────────

    const handleMax = () => {
        if (mode === 'stake') {
            setAmount(exactUmaBalance);
        } else {
            setAmount(exactStakedBalance);
        }
    };

    const handleApprove = async () => {
        if (!umaTokenAddress) return;
        setIsPending(true);
        try {
            await writeApprove({
                address: umaTokenAddress as `0x${string}`,
                abi: ERC20_ABI,
                functionName: 'approve',
                args: [SOP_VAULT_ADDRESS, maxUint256],
            });
            // Wait for tx to be mined + RPC sync
            await new Promise(r => setTimeout(r, 8000));
            await refetchAllowance();
            showToast('TRANSACTION SUCCESSFUL', 'success');
        } catch (e: unknown) {
            console.error('Approval failed:', e);
            showToast('TRANSACTION CANCELLED', 'error');
        }
        setIsPending(false);
    };

    const handleStake = async () => {
        if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) return;
        setIsPending(true);
        try {
            const parsedAmount = parseUnits(amount, 18);
            await writeStake({
                address: SOP_VAULT_ADDRESS,
                abi: SOP_VAULT_ABI,
                functionName: 'stake',
                args: [parsedAmount],
            });
            setAmount('');
            await new Promise(r => setTimeout(r, 5000));
            refetchStakedBalance();
            refetchUmaBalance();
            refetchTvl();
            showToast('TRANSACTION SUCCESSFUL', 'success');
        } catch (e: unknown) {
            console.error('Stake failed:', e);
            showToast('TRANSACTION CANCELLED', 'error');
        }
        setIsPending(false);
    };

    const handleUnstake = async () => {
        if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) return;
        setIsPending(true);
        try {
            const parsedAmount = parseUnits(amount, 18);
            await writeUnstake({
                address: SOP_VAULT_ADDRESS,
                abi: SOP_VAULT_ABI,
                functionName: 'unstake',
                args: [parsedAmount],
            });
            setAmount('');
            await new Promise(r => setTimeout(r, 5000));
            refetchStakedBalance();
            refetchUmaBalance();
            refetchTvl();
            showToast('TRANSACTION SUCCESSFUL', 'success');
        } catch (e: unknown) {
            console.error('Unstake failed:', e);
            showToast('TRANSACTION CANCELLED', 'error');
        }
        setIsPending(false);
    };

    // ── Button Label & Handler ──────────────────────────────────────

    const isValidAmount = !!amount && !isNaN(Number(amount)) && Number(amount) > 0;

    // Check if user is trying to use more than they have
    const insufficientBalance = useMemo(() => {
        if (!isValidAmount) return false;
        try {
            const parsedAmount = parseUnits(amount, 18);
            if (mode === 'stake') {
                const bal = rawUmaBalance as bigint | undefined;
                return bal !== undefined && parsedAmount > bal;
            } else {
                const staked = rawStakedBalance as bigint | undefined;
                return staked !== undefined && parsedAmount > staked;
            }
        } catch {
            return false;
        }
    }, [mode, amount, isValidAmount, rawUmaBalance, rawStakedBalance]);

    let buttonLabel: string;
    let buttonHandler: () => void;
    let buttonDisabled: boolean;

    if (insufficientBalance) {
        buttonLabel = 'INSUFFICIENT BALANCE';
        buttonHandler = () => { };
        buttonDisabled = true;
    } else if (mode === 'stake') {
        if (needsApproval) {
            buttonLabel = isPending ? 'APPROVING...' : 'APPROVE';
            buttonHandler = handleApprove;
            buttonDisabled = isPending || !address || !isValidAmount;
        } else {
            buttonLabel = isPending ? 'STAKING...' : 'STAKE';
            buttonHandler = handleStake;
            buttonDisabled = isPending || !address || !isValidAmount;
        }
    } else {
        buttonLabel = isPending ? 'UNSTAKING...' : 'UNSTAKE';
        buttonHandler = handleUnstake;
        buttonDisabled = isPending || !address || !isValidAmount;
    }

    // ── Mock Data: Past Resolved Markets ────────────────────────────

    const mockResolvedMarkets = [
        { id: 1, question: 'Will Bitcoin exceed $100K by Jan 2026?', outcome: true, umaReward: 142.5, date: '2025-12-28' },
        { id: 2, question: 'Will Ethereum merge to PoS successfully?', outcome: true, umaReward: 210.0, date: '2025-11-15' },
        { id: 3, question: 'Will the Fed cut rates in Q4 2025?', outcome: false, umaReward: 88.3, date: '2025-12-01' },
        { id: 4, question: 'Will SpaceX land Starship by Nov 2025?', outcome: true, umaReward: 175.0, date: '2025-10-22' },
        { id: 5, question: 'Will US GDP growth exceed 3% in 2025?', outcome: false, umaReward: 63.7, date: '2025-09-30' },
        { id: 6, question: 'Will Solana TVL surpass $20B?', outcome: true, umaReward: 124.8, date: '2025-08-14' },
        { id: 7, question: 'Will OpenAI release GPT-5 by 2025?', outcome: false, umaReward: 95.2, date: '2025-07-20' },
        { id: 8, question: 'Will a major CEX face insolvency in 2025?', outcome: false, umaReward: 110.0, date: '2025-06-05' },
    ];

    const totalMarketsResolved = mockResolvedMarkets.length;
    const totalUmaEarned = mockResolvedMarkets.reduce((sum, m) => sum + m.umaReward, 0);
    const avgVoteRate = 94.4; // mock: percentage of all markets the protocol participated in

    // ── Render ───────────────────────────────────────────────────────

    return (
        <div className="p-6 max-w-7xl mx-auto mt-20">
            <h1 className="text-3xl font-bold mb-10 tracking-widest text-center uppercase border-b border-white pb-4">
                Staking Hub
            </h1>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

                {/* ═══════ LEFT COLUMN: Protocol Metrics ═══════ */}
                <div className="flex flex-col gap-8">

                    {/* Summary Metrics */}
                    <div className="border border-white p-8">
                        <h2 className="text-sm text-gray-400 uppercase tracking-widest mb-6 border-b border-white pb-3">
                            Protocol Performance
                        </h2>
                        <div className="grid grid-cols-3 gap-6">
                            <div>
                                <p className="text-sm text-gray-400 uppercase tracking-widest mb-1">Markets Resolved</p>
                                <p className="text-3xl text-white font-mono">{totalMarketsResolved}</p>
                            </div>
                            <div>
                                <p className="text-sm text-gray-400 uppercase tracking-widest mb-1">Total UMA Earned</p>
                                <p className="text-3xl text-green font-mono">{totalUmaEarned.toFixed(1)}</p>
                            </div>
                            <div>
                                <p className="text-sm text-gray-400 uppercase tracking-widest mb-1">Avg Vote Rate</p>
                                <p className="text-3xl text-white font-mono">{avgVoteRate}%</p>
                            </div>
                        </div>
                    </div>

                    {/* Past Resolved Markets List */}
                    <div className="border border-white p-8 flex flex-col flex-1">
                        <h2 className="text-sm text-gray-400 uppercase tracking-widest mb-6 border-b border-white pb-3">
                            Resolved Markets
                        </h2>
                        <div className="flex flex-col gap-0 overflow-y-auto max-h-[480px]">
                            {mockResolvedMarkets.map((market) => (
                                <div
                                    key={market.id}
                                    className="border border-white p-4 flex items-start justify-between gap-4 -mt-px first:mt-0"
                                >
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-mono text-white leading-tight truncate">
                                            {market.question}
                                        </p>
                                        <p className="text-xs text-gray-400 font-mono mt-1">
                                            {market.date}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-4 shrink-0">
                                        <span className="text-sm font-mono text-green">
                                            +{market.umaReward} UMA
                                        </span>
                                        <span
                                            className={`text-sm font-bold font-mono uppercase tracking-widest ${market.outcome ? 'text-green' : 'text-red'
                                                }`}
                                        >
                                            {market.outcome ? 'YES' : 'NO'}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* ═══════ RIGHT COLUMN: Staking Panel ═══════ */}
                <div className="flex flex-col gap-8">

                    {/* Stats Row */}
                    <div className="border border-white p-8 grid grid-cols-2 gap-8">
                        <div>
                            <h3 className="text-sm text-gray-400 uppercase tracking-widest mb-2">Global TVL</h3>
                            <p className="text-4xl text-green font-mono">{displayTvl} UMA</p>
                        </div>
                        <div>
                            <h3 className="text-sm text-gray-400 uppercase tracking-widest mb-2">Current APY</h3>
                            <p className="text-4xl text-green font-mono">{displayApy}</p>
                        </div>
                    </div>

                    {/* Stake / Unstake Panel */}
                    <div className="border border-white p-8 flex flex-col gap-6">
                        {/* Toggle */}
                        <div className="flex border border-white">
                            <button
                                onClick={() => { setMode('stake'); setAmount(''); }}
                                className={`flex-1 py-3 text-sm uppercase tracking-widest font-bold transition-colors ${mode === 'stake'
                                    ? 'bg-white text-black'
                                    : 'bg-black text-white hover:bg-white/10'
                                    }`}
                            >
                                Stake
                            </button>
                            <button
                                onClick={() => { setMode('unstake'); setAmount(''); }}
                                className={`flex-1 py-3 text-sm uppercase tracking-widest font-bold transition-colors ${mode === 'unstake'
                                    ? 'bg-white text-black'
                                    : 'bg-black text-white hover:bg-white/10'
                                    }`}
                            >
                                Unstake
                            </button>
                        </div>

                        {/* Balance info */}
                        <div className="flex justify-between items-center text-sm uppercase tracking-widest text-gray-400">
                            <span>
                                Wallet:{' '}
                                <span className="text-white font-mono">
                                    {umaBalance} UMA
                                </span>
                            </span>
                            <span>
                                Staked: <span className="text-white font-mono">{displayStakedBalance} UMA</span>
                            </span>
                        </div>

                        {/* Input + MAX */}
                        <div className="flex border border-white">
                            <input
                                type="number"
                                value={amount}
                                onChange={(e) => setAmount(e.target.value)}
                                placeholder="Amount (UMA)"
                                className="flex-1 bg-black p-4 font-mono text-white outline-none"
                            />
                            <button
                                onClick={handleMax}
                                disabled={!address}
                                className="px-6 bg-black text-gray-400 font-bold uppercase tracking-widest text-sm border-l border-white hover:text-white transition-colors disabled:opacity-50"
                            >
                                MAX
                            </button>
                        </div>

                        {/* Action Button */}
                        <button
                            onClick={buttonHandler}
                            disabled={buttonDisabled}
                            className={`w-full font-bold uppercase tracking-widest py-4 border transition-colors disabled:opacity-50 ${mode === 'unstake'
                                ? 'bg-black text-white border-white hover:border-red hover:text-red'
                                : 'bg-white text-black border-white hover:bg-black hover:text-white'
                                }`}
                        >
                            {buttonLabel}
                        </button>
                    </div>
                </div>
            </div>

            {/* Toast Notification */}
            {toast && (
                <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-8 py-4 border font-bold uppercase tracking-widest text-sm animate-pulse ${toast.type === 'success' ? 'bg-green border-green text-black' : 'bg-red border-red text-white'
                    }`}>
                    {toast.msg}
                </div>
            )}
        </div>
    );
}
