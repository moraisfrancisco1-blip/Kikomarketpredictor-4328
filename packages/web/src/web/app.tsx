import { Route, Switch } from "wouter";
import Index from "./pages/index";
import { Provider } from "./components/provider";
import { AuthGate } from "./components/auth-gate";

function App() {
  return (
    <Provider>
      <AuthGate>
        <Switch>
          <Route path="/" component={Index} />
        </Switch>
      </AuthGate>
    </Provider>
  );
}

export default App;
