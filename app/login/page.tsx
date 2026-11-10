import React, { Suspense } from 'react';
import { LoginForm } from '@/components/auth/LoginForm';

export default function LoginPage() {
  return (
    <div className="flex items-center justify-center min-h-[75vh] py-10 px-4">
      <Suspense
        fallback={
          <div className="w-full max-w-md h-96 rounded-2xl bg-[#0A0A0A] border border-[#292929] animate-pulse" />
        }
      >
        <LoginForm />
      </Suspense>
    </div>
  );
}
