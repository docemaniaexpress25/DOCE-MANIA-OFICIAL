"use client";

import dynamic from 'next/dynamic';

const DoceManiaApp = dynamic(() => import('@/lib/doce-app'), { ssr: false });

export default function Page() {
  return <DoceManiaApp />;
}
