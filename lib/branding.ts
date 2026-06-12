// Centralized branding configuration for IbmDigitech HRMS
// Change these values to rebrand the entire application

export const BRANDING = {
  companyName: "IbmDigitech",
  companyFullName: "IbmDigitech LLC",
  systemName: "IbmDigitech HRMS",
  systemTagline: "Enterprise HR Management System",
  logoPath: "/assets/logo.svg",
  logoAlt: "IbmDigitech Logo",
  website: "https://ibmdigitech.com",
  email: "hr@ibmdigitech.com",
  phone: "+971 4 123 4567",
  address: "Dubai, UAE",
  copyright: `© ${new Date().getFullYear()} IbmDigitech | Enterprise HRMS | UAE`,
} as const;

export type Branding = typeof BRANDING;
