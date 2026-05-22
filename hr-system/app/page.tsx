import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center space-y-12 p-8">
      <div className="text-center space-y-4">
        <h1 className="text-5xl font-extrabold tracking-tight bg-gradient-to-r from-blue-600 to-purple-600 text-transparent bg-clip-text">
          HR Management System
        </h1>
        <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
          Automated Payroll, Salary Structures, and Professional Letter Generation. All in one place.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 w-full max-w-4xl">
        <div className="p-6 border rounded-xl shadow-sm hover:shadow-md transition-shadow bg-card">
          <h2 className="text-2xl font-bold mb-4">Payroll System</h2>
          <p className="text-muted-foreground mb-6">
            Manage employee salaries, define structures with auto-calculations, and generate monthly payslips instantly.
          </p>
          <Link href="/payroll">
            <Button size="lg" className="w-full">
              Enter Payroll Module
            </Button>
          </Link>
        </div>

        <div className="p-6 border rounded-xl shadow-sm hover:shadow-md transition-shadow bg-card">
          <h2 className="text-2xl font-bold mb-4">Letter Generation</h2>
          <p className="text-muted-foreground mb-6">
            Create professional Offer, Appointment, and Relieving letters with automated PDF generation.
          </p>
          <Link href="/letters">
            <Button size="lg" variant="secondary" className="w-full">
              Enter Letter Module
            </Button>
          </Link>
        </div>
      </div>

      <div className="text-sm text-muted-foreground">
        Running on Next.js 15 & Mock Data Service
      </div>
    </div>
  );
}
