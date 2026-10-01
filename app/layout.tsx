import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/layout/SidebarOptimized";
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
              {/* min-w-0 on the content column AND on <main>.
                  A flex item defaults to min-width:auto, which means it refuses
                  to shrink below its content's intrinsic width. Without this,
                  a wide table (min-w-[800px]) forced the whole content column
                  past the viewport and the page scrolled sideways, clipping
                  the first and last table columns. min-w-0 lets the inner
                  overflow-x-auto actually engage. */}
              <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                {isLoggedIn && <Header user={userWithPhoto} />}
                {/* Responsive padding: `p-6` applied 24px on a 375px screen on
                    top of each page's own `p-4`, leaving ~295px of content
                    width. `p-3` at the base breakpoint recovers ~12px on every
                    page at once; the full `p-6` is restored from `sm:` up. */}
                <main className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-6">
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


