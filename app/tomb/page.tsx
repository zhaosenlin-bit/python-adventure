"use client";

import dynamicImport from "next/dynamic";
import { useRouter } from "next/navigation";

const TombGame = dynamicImport(() => import("@/components/tomb/TombGame"), {
    ssr: false,
    loading: () => (
        <div className="flex h-[100dvh] w-full items-center justify-center bg-[#07060c]">
            <div className="text-center">
                <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-amber-300/20 border-t-amber-300" />
                <p className="text-sm text-slate-400">古墓场景加载中…</p>
            </div>
        </div>
    ),
});

export default function TombPage() {
    return (
        <div className="relative h-[100dvh] w-full overflow-hidden bg-[#07060c]">
            <TombGame />
        </div>
    );
}
