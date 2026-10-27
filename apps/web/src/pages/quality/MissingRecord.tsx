import { Empty } from "../../ui/Empty";
import { HashLink } from "../../ui/HashLink";
import { PageTitle } from "../../ui/PageTitle";
import { Panel } from "../../ui/Panel";

export function MissingRecord({ title, back }: { title: string; back: string }) {
  return (
    <>
      <PageTitle title={title} subtitle="请从列表中选择对应记录。" />
      <Panel core title="记录不可用">
        <Empty text={title} />
        <div className="toolbar">
          <HashLink route={back}>返回列表</HashLink>
        </div>
      </Panel>
    </>
  );
}
