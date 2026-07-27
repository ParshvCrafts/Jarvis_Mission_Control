import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Switch, Router as WouterRouter, Redirect } from "wouter";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import Shell from "@/components/layout/Shell";
import { PendingChangesProvider } from "@/contexts/PendingChangesContext";
import TodayPage from "@/pages/today/TodayPage";
import ApplicationsPage from "@/pages/applications/ApplicationsPage";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function Router() {
  return (
    <Shell>
      <Switch>
        <Route path="/">
          <Redirect to="/today" />
        </Route>
        <Route path="/today" component={TodayPage} />
        <Route path="/applications" component={ApplicationsPage} />
        <Route component={NotFound} />
      </Switch>
    </Shell>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={400}>
        <PendingChangesProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster
            position="bottom-right"
            offset={16}
            toastOptions={{
              classNames: {
                toast:
                  "!bg-zinc-900 !border-zinc-800 !text-zinc-100 !shadow-xl",
                description: "!text-zinc-400",
                actionButton: "!bg-zinc-800 !text-zinc-100",
                cancelButton: "!bg-zinc-800 !text-zinc-100",
              },
            }}
          />
        </PendingChangesProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}
