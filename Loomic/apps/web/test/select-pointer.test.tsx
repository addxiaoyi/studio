import {afterEach,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen} from "@testing-library/react";
import {StyledSelect} from "@/components/ui/styled-select";

afterEach(cleanup);
it("commits a pressed option even before a mousemove render highlights it",async()=>{
  const changed=vi.fn();
  render(<StyledSelect aria-label="工程视图" value="canvas" options={[{value:"canvas",label:"画布"},{value:"video",label:"视频剪辑"}]} onChange={changed}/>);
  fireEvent.click(screen.getByRole("combobox",{name:"工程视图"}));
  const option=await screen.findByRole("option",{name:"视频剪辑"});
  const press=new MouseEvent("pointerdown",{button:0,bubbles:true});
  Object.defineProperty(press,"pointerType",{value:"mouse"});
  fireEvent(option,press);
  fireEvent.click(option);
  expect(changed).toHaveBeenCalledWith("video");
});
