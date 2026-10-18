import { LoginEnteringScreen } from "@/components/login/LoginEnteringScreen";

export default function CompleteLoginLoading() {
  return <LoginEnteringScreen activeStep={2} loginLabel="登录已完成" />;
}
