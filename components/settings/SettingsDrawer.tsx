"use client";

import * as React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel,  } from "@/components/ui/form";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";
import Link from "next/link";

interface SettingsDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsDrawer({ onOpenChange }: SettingsDrawerProps) {
  return (
    <div className="fixed right-0 top-0 z-50 flex h-full w-56 max-w-[500px] overflow-hidden border-l border-slate-200 bg-white/90 dark:bg-slate-950/90 backdrop-blur-xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 sm:rounded-lg">
      <div className="flex h-full w-full flex-col overflow-hidden">
        {/* Drawer Header */}
        <div className="flex flex-shrink-0 items-center justify-between p-6 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">System Settings</h2>
          <button 
            onClick={() => onOpenChange(false)} 
            className="rounded-sm p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Drawer Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <Tabs defaultValue="general" className="w-full space-y-2">
            <TabsList className="grid w-full grid-cols-[repeat(2,minmax(0,1fr))] gap-2 text-sm font-medium">
              <TabsTrigger value="general">General</TabsTrigger>
              <TabsTrigger value="company">Company</TabsTrigger>
              <TabsTrigger value="employee">Employee</TabsTrigger>
              <TabsTrigger value="attendance">Attendance</TabsTrigger>
              <TabsTrigger value="leave">Leave</TabsTrigger>
              <TabsTrigger value="payroll">Payroll</TabsTrigger>
              <TabsTrigger value="visa">Visa & Docs</TabsTrigger>
              <TabsTrigger value="workflow">Workflow</TabsTrigger>
              <TabsTrigger value="letters">Letters</TabsTrigger>
              <TabsTrigger value="notifications">Notifications</TabsTrigger>
              <TabsTrigger value="roles">Roles</TabsTrigger>
              <TabsTrigger value="security">Security</TabsTrigger>
              <TabsTrigger value="backup">Backup</TabsTrigger>
              <TabsTrigger value="logs">Logs</TabsTrigger>
              <TabsTrigger value="integrations">Integrations</TabsTrigger>
            </TabsList>

            {/* General Settings */}
            <TabsContent value="general">
              <Form>
                <FormField>
                  <FormLabel>Company Name</FormLabel>
                  <FormControl>
                    <Input placeholder="IBM Digitech Enterprise" />
                  </FormControl>
                </FormField>
                
                <FormField>
                  <FormLabel>System Name</FormLabel>
                  <FormControl>
                    <Input placeholder="HRMS" />
                  </FormControl>
                </FormField>
                
                <FormField>
                  <FormLabel>Time Zone</FormLabel>
                  <FormControl>
                    <Select>
                      <SelectTrigger className="w-[200px]">
                        <SelectValue placeholder="Select timezone" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="GMT+4">GMT +4 (UAE)</SelectItem>
                        <SelectItem value="GMT+0">GMT +0</SelectItem>
                        <SelectItem value="GMT-5">GMT -5 (EST)</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormControl>
                </FormField>
                
                <FormField>
                  <FormLabel>Date Format</FormLabel>
                  <FormControl>
                    <Select>
                      <SelectTrigger className="w-[200px]">
                        <SelectValue placeholder="Select format" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="DD/MM/YYYY">DD/MM/YYYY</SelectItem>
                        <SelectItem value="MM/DD/YYYY">MM/DD/YYYY</SelectItem>
                        <SelectItem value="YYYY/MM/DD">YYYY/MM/DD</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormControl>
                </FormField>
                
                <FormField>
                  <FormLabel>Currency</FormLabel>
                  <FormControl>
                    <Select>
                      <SelectTrigger className="w-[200px]">
                        <SelectValue placeholder="Select currency" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="AED">AED (UAE Dirham)</SelectItem>
                        <SelectItem value="USD">USD (US Dollar)</SelectItem>
                        <SelectItem value="EUR">EUR (Euro)</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormControl>
                </FormField>
                
                <FormField>
                  <FormLabel>Language</FormLabel>
                  <FormControl>
                    <Select>
                      <SelectTrigger className="w-[200px]">
                        <SelectValue placeholder="Select language" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="en">English</SelectItem>
                        <SelectItem value="ar">Arabic</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormControl>
                </FormField>
                
                <div className="flex justify-end gap-3 mt-8">
                  <Button variant="outline" onClick={() => {/* Reset logic */}}>
                    Reset
                  </Button>
                  <Button onClick={() => {/* Save logic */}}>
                    Save Changes
                  </Button>
                </div>
              </Form>
            </TabsContent>

            {/* Company Settings */}
            <TabsContent value="company">
              <Form>
                <FormField>
                  <FormLabel>Company Logo</FormLabel>
                  <FormControl>
                    {/* Upload component would go here */}
                    <input type="file" accept="image/*" className="block w-full text-sm text-slate-500" />
                  </FormControl>
                </FormField>
                
                <FormField>
                  <FormLabel>Company Name</FormLabel>
                  <FormControl>
                    <Input placeholder="IBM Digitech Enterprise LLC" />
                  </FormControl>
                </FormField>
                
                <FormField>
                  <FormLabel>Trade License Number</FormLabel>
                  <FormControl>
                    <Input placeholder="TL-123456-789" />
                  </FormControl>
                </FormField>
                
                <FormField>
                  <FormLabel>Address</FormLabel>
                  <FormControl>
                    <Textarea placeholder="Dubai, UAE" className="h-[80px]" />
                  </FormControl>
                </FormField>
                
                <FormField>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="info@company.com" />
                  </FormControl>
                </FormField>
                
                <FormField>
                  <FormLabel>Phone</FormLabel>
                  <FormControl>
                    <Input type="tel" placeholder="+971 4 123 4567" />
                  </FormControl>
                </FormField>
                
                <FormField>
                  <FormLabel>Website</FormLabel>
                  <FormControl>
                    <Input placeholder="https://company.com" />
                  </FormControl>
                </FormField>
                
                <div className="flex justify-end gap-3 mt-8">
                  <Button variant="outline" onClick={() => {/* Reset logic */}}>
                    Reset
                  </Button>
                  <Button onClick={() => {/* Save logic */}}>
                    Save Changes
                  </Button>
                </div>
              </Form>
            </TabsContent>

            {/* Employee Settings */}
            <TabsContent value="employee">
              <Form>
                <FormField>
                  <FormLabel>Employee ID Format</FormLabel>
                  <FormControl>
                    <Input placeholder="EMP-0001" />
                  </FormControl>
                </FormField>
                
                <FormField>
                  <FormLabel>ID Generation Method</FormLabel>
                  <FormControl>
                    <Select>
                      <SelectTrigger className="w-[200px]">
                        <SelectValue placeholder="Select method" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">Auto Generate</SelectItem>
                        <SelectItem value="manual">Manual Entry</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormControl>
                </FormField>
                
                <FormField>
                  <FormLabel>Default Employee Status</FormLabel>
                  <FormControl>
                    <Select>
                      <SelectTrigger className="w-[200px]">
                        <SelectValue placeholder="Select status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="inactive">Inactive</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormControl>
                </FormField>
                
                <div className="flex justify-end gap-3 mt-8">
                  <Button variant="outline" onClick={() => {/* Reset logic */}}>
                    Reset
                  </Button>
                  <Button onClick={() => {/* Save logic */}}>
                    Save Changes
                  </Button>
                </div>
              </Form>
            </TabsContent>

            {/* Attendance Settings */}
            <TabsContent value="attendance">
              <Form>
                <FormField>
                  <FormLabel>Office Start Time</FormLabel>
                  <FormControl>
                    <Input type="time" value="09:00" />
                  </FormControl>
                </FormField>
                
                <FormField>
                  <FormLabel>Office End Time</FormLabel>
                  <FormControl>
                    <Input type="time" value="18:00" />
                  </FormControl>
                </FormField>
                
                <FormField>
                  <FormLabel>Grace Period (Minutes)</FormLabel>
                  <FormControl>
                    <Input type="number" value="15" min="0" />
                  </FormControl>
                </FormField>
                
                <FormField>
                  <FormLabel>Overtime Enabled</FormLabel>
                  <FormControl>
                    <Switch checked={true} />
                  </FormControl>
                </FormField>
                
<FormField>
  <FormLabel>Weekend Configuration</FormLabel>
  <FormControl>
    <div className="space-y-2">
      <div className="flex items-center space-x-2">
        <Checkbox defaultChecked={false} id="friday" />
        <span className="ml-2">Friday</span>
      </div>
      <div className="flex items-center space-x-2">
        <Checkbox defaultChecked={true} id="saturday" />
        <span className="ml-2">Saturday</span>
      </div>
      <div className="flex items-center space-x-2">
        <Checkbox defaultChecked={true} id="sunday" />
        <span className="ml-2">Sunday</span>
      </div>
    </div>
  </FormControl>
</FormField>
                
                <FormField>
                  <FormLabel>Geo Location Attendance</FormLabel>
                  <FormControl>
                    <Switch checked={false} />
                  </FormControl>
                </FormField>
                
                <FormField>
                  <FormLabel>Biometric Integration</FormLabel>
                  <FormControl>
                    <Switch checked={false} />
                  </FormControl>
                </FormField>
                
                <div className="flex justify-end gap-3 mt-8">
                  <Button variant="outline" onClick={() => {/* Reset logic */}}>
                    Reset
                  </Button>
                  <Button onClick={() => {/* Save logic */}}>
                    Save Changes
                  </Button>
                </div>
              </Form>
            </TabsContent>

            {/* Placeholder tabs for brevity - in a real implementation, all tabs would be filled out */}
            <TabsContent value="leave">
              <div className="p-6">
                <h3 className="font-semibold mb-4">Leave Settings</h3>
                <p className="text-slate-500">Leave configuration options would appear here.</p>
                <div className="flex justify-end gap-3 mt-8">
                  <Button variant="outline">Reset</Button>
                  <Button>Save Changes</Button>
                </div>
              </div>
            </TabsContent>
            
            <TabsContent value="payroll">
              <div className="p-6">
                <h3 className="font-semibold mb-4">Payroll Settings</h3>
                <p className="text-slate-500">Payroll configuration options would appear here.</p>
                <div className="flex justify-end gap-3 mt-8">
                  <Button variant="outline">Reset</Button>
                  <Button>Save Changes</Button>
                </div>
              </div>
            </TabsContent>
            
            <TabsContent value="visa">
              <div className="p-6">
                <h3 className="font-semibold mb-4">Visa & Documents Settings</h3>
                <p className="text-slate-500">Visa and document configuration options would appear here.</p>
                <div className="flex justify-end gap-3 mt-8">
                  <Button variant="outline">Reset</Button>
                  <Button>Save Changes</Button>
                </div>
              </div>
            </TabsContent>
            
            <TabsContent value="workflow">
              <div className="p-6">
                <h3 className="font-semibold mb-4">Request Workflow Settings</h3>
                <p className="text-slate-500">Workflow configuration options would appear here.</p>
                <div className="flex justify-end gap-3 mt-8">
                  <Button variant="outline">Reset</Button>
                  <Button>Save Changes</Button>
                </div>
              </div>
            </TabsContent>
            
            <TabsContent value="letters">
              <div className="p-6">
                <h3 className="font-semibold mb-4">Letter Templates Settings</h3>
                <p className="text-slate-500">Letter template configuration options would appear here.</p>
                <div className="flex justify-end gap-3 mt-8">
                  <Button variant="outline">Reset</Button>
                  <Button>Save Changes</Button>
                </div>
              </div>
            </TabsContent>
            
            <TabsContent value="notifications">
              <div className="p-6">
                <h3 className="font-semibold mb-4">Notifications Settings</h3>
                <p className="text-slate-500">Notification configuration options would appear here.</p>
                <div className="flex justify-end gap-3 mt-8">
                  <Button variant="outline">Reset</Button>
                  <Button>Save Changes</Button>
                </div>
              </div>
            </TabsContent>
            
            <TabsContent value="roles">
              <div className="p-6">
                <h3 className="font-semibold mb-4">Roles & Permissions Settings</h3>
                <p className="text-slate-500">Roles and permissions configuration options would appear here.</p>
                <div className="flex justify-end gap-3 mt-8">
                  <Button variant="outline">Reset</Button>
                  <Button>Save Changes</Button>
                </div>
              </div>
            </TabsContent>
            
            <TabsContent value="security">
              <div className="p-6">
                <h3 className="font-semibold mb-4">Security Settings</h3>
                <p className="text-slate-500">Security configuration options would appear here.</p>
                <div className="flex justify-end gap-3 mt-8">
                  <Button variant="outline">Reset</Button>
                  <Button>Save Changes</Button>
                </div>
              </div>
            </TabsContent>
            
            <TabsContent value="backup">
              <div className="p-6">
                <h3 className="font-semibold mb-2">Automatic database backup</h3>
                <p className="text-sm text-slate-500">Install the nightly 02:00 backup on the Windows host running PostgreSQL and Docker. Backups are saved to <code>backups/</code>; the latest 14 are retained.</p>
                <pre className="mt-4 overflow-x-auto rounded-lg bg-slate-950 p-4 text-xs text-slate-100">{`powershell -ExecutionPolicy Bypass -File .\\scripts\\register-backup-task.ps1`}</pre>
                <p className="mt-3 text-xs text-amber-700">Run once on the database host. Keep an off-host copy of the backup folder for disaster recovery.</p>
                <Link href="/system/logs" className="mt-5 inline-flex text-sm font-semibold text-indigo-600 hover:underline" onClick={() => onOpenChange(false)}>View system logs →</Link>
              </div>
            </TabsContent>

            <TabsContent value="logs">
              <div className="p-6">
                <h3 className="font-semibold mb-2">System logs</h3>
                <p className="text-sm text-slate-500">Review security events, access outcomes, and employee record activity.</p>
                <Link href="/system/logs" className="mt-4 inline-flex text-sm font-semibold text-indigo-600 hover:underline" onClick={() => onOpenChange(false)}>Open log viewer →</Link>
              </div>
            </TabsContent>
            
            <TabsContent value="integrations">
              <div className="p-6">
                <h3 className="font-semibold mb-4">Integrations Settings</h3>
                <p className="text-slate-500">Integration configuration options would appear here.</p>
                <div className="flex justify-end gap-3 mt-8">
                  <Button variant="outline">Reset</Button>
                  <Button>Save Changes</Button>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

// Helper components (these would normally be imported from '@/components/ui/*' but we're defining them here for completeness)
const Label = React.forwardRef<
  React.ElementRef<'label'>,
  React.ComponentPropsWithoutRef<'label'>
>(({ className, ...props }, ref) => (
  <label
    className={cn(
      "text-sm font-medium text-slate-900 dark:text-slate-100",
      className
    )}
    ref={ref}
    {...props}
  />
));
Label.displayName = "Label";
