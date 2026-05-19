import Sidebar from "@/components/ui/sidebar";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-row bg-[#020202] text-white w-full">
      <Sidebar />
      <div className="pl-20 flex-1 flex flex-col min-w-0">
        {children}
      </div>
    </div>
  );
}
