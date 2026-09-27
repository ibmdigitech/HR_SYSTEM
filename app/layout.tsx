import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { Toaster } from "sonner";
import { Providers } from "@/components/common/Providers";
import { auth } from "@/auth";

import prisma from "@/lib/prisma";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "HR System",
  description: "Modern HR Management System",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();
  const isLoggedIn = !!session?.user;

  let userWithPhoto = session?.user;
  if (isLoggedIn && session?.user?.email) {
    try {
      const dbUser = await prisma.user.findUnique({
        where: { email: session.user.email },
        include: { employee: { select: { photo: true } } }
      });
      if (dbUser) {
        userWithPhoto = {
          ...session.user,
          image: dbUser.employee?.photo || dbUser.image || session.user.image,
        };
      }
    } catch (e) {
      console.error("Failed to fetch user photo from db:", e);
    }
  }

  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen bg-slate-50 dark:bg-slate-900`}
      >
        {/* Providers supplies the SessionProvider required by useSession().
            The application had none, so the login page's session check threw
            at runtime while still passing `tsc`. */}
        <Providers>
          <div className="flex h-screen overflow-hidden">
            {isLoggedIn && <Sidebar user={userWithPhoto} />}
            <div className="flex flex-1 flex-col overflow-hidden">
              {isLoggedIn && <Header user={userWithPhoto} />}
              <main className="flex-1 overflow-y-auto p-6">
                {children}
              </main>
            </div>
          </div>
        </Providers>
        <Toaster position="top-right" richColors closeButton />
      </body>
    </html>
  );
}


