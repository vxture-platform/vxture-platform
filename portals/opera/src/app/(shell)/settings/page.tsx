"use client";

/* Settings — 控制平面基础配置（界面先行，提交动作功能期接线）。 */

import {
  Button,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FormPageTemplate,
  Input,
  NativeSelect,
  Switch,
  ViewHeader,
} from "@vxture/design-system";

export default function SettingsPage() {
  return (
    <FormPageTemplate
      header={
        <ViewHeader
          icon="settings"
          title="Settings"
          description="控制平面基础配置：健康探测、计量聚合与审计保留策略。"
        />
      }
      footer={
        <>
          <Button variant="outline">还原</Button>
          <Button disabled title="功能排期，界面先行">
            保存变更
          </Button>
        </>
      }
    >
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="probe-interval">健康探测间隔</FieldLabel>
          <NativeSelect id="probe-interval" defaultValue="60">
            <option value="30">每 30 秒</option>
            <option value="60">每 60 秒</option>
            <option value="300">每 5 分钟</option>
          </NativeSelect>
          <FieldDescription>
            对每个在线 Provider 的 API 探测频率；降级判定阈值 P95 800ms。
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="rollup">计量聚合窗口</FieldLabel>
          <NativeSelect id="rollup" defaultValue="hour">
            <option value="hour">每小时</option>
            <option value="day">每天</option>
          </NativeSelect>
          <FieldDescription>
            原始请求事实按窗口聚合入 Metering；原始记录保留 90 天。
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="audit-days">审计保留天数</FieldLabel>
          <Input
            id="audit-days"
            type="number"
            defaultValue={365}
            className="max-w-media-xl"
          />
          <FieldDescription>Audit 记录只读，到期归档不删除。</FieldDescription>
        </Field>

        <Field orientation="horizontal">
          <Switch id="failover-auto" defaultChecked />
          <FieldLabel htmlFor="failover-auto">自动 Failover</FieldLabel>
        </Field>
        <Field orientation="horizontal">
          <Switch id="alert-degrade" defaultChecked />
          <FieldLabel htmlFor="alert-degrade">
            Provider 降级时通知值班
          </FieldLabel>
        </Field>
      </FieldGroup>
    </FormPageTemplate>
  );
}
