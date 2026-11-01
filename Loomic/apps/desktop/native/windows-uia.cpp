#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <ole2.h>
#include <UIAutomation.h>
#include <wrl/client.h>
#include <fcntl.h>
#include <io.h>
#include <cstdio>
#include <cwctype>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

using Microsoft::WRL::ComPtr;
constexpr size_t MAX_TRAVERSAL_NODES = 10'000;
constexpr size_t MAX_RETURNED_CONTROLS = 240;

static void check(HRESULT hr) {
  if (FAILED(hr)) throw std::runtime_error("Windows accessibility provider is unavailable.");
}

static std::string utf8(const std::wstring& value) {
  if (value.empty()) return "";
  int length = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
  if (!length) throw std::runtime_error("Invalid Unicode from accessibility provider.");
  std::string bytes(length, '\0');
  WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), bytes.data(), length, nullptr, nullptr);
  return bytes;
}

static std::string json(const std::wstring& value) {
  std::string encoded = "\"";
  for (unsigned char c : utf8(value)) {
    if (c == '\\' || c == '"') { encoded += '\\'; encoded += static_cast<char>(c); }
    else if (c < 32) { char hex[7]; sprintf_s(hex, "\\u%04x", c); encoded += hex; }
    else encoded += static_cast<char>(c);
  }
  return encoded + "\"";
}

static std::wstring nameOf(IUIAutomationElement* element) {
  BSTR name = nullptr;
  check(element->get_CurrentName(&name));
  std::wstring title(name ? name : L"", name ? SysStringLen(name) : 0);
  SysFreeString(name);
  return title.substr(0, 300);
}

static bool sensitive(std::wstring name) {
  for (auto& c : name) c = static_cast<wchar_t>(towlower(c));
  for (auto hint : {L"password", L"passcode", L"otp", L"verification", L"one-time", L"mfa", L"token", L"密码", L"验证码", L"口令", L"密钥"}) {
    if (name.find(hint) != std::wstring::npos) return true;
  }
  return false;
}

struct Control {
  ComPtr<IUIAutomationElement> element;
  std::wstring name;
  RECT rect{};
  CONTROLTYPEID type{};
  BOOL enabled{}, focused{}, password{};
};

struct WindowSnapshot {
  HWND hwnd{};
  DWORD pid{};
  ULONGLONG processStarted{};
  std::wstring title;
  std::vector<Control> controls;
};

static WindowSnapshot inspect() {
  WindowSnapshot snapshot;
  snapshot.hwnd = GetForegroundWindow();
  if (!snapshot.hwnd || !IsWindowVisible(snapshot.hwnd)) throw std::runtime_error("No accessible foreground window.");
  GetWindowThreadProcessId(snapshot.hwnd, &snapshot.pid);
  HANDLE process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, snapshot.pid);
  if (process) {
    FILETIME created{}, exited{}, kernel{}, user{};
    if (GetProcessTimes(process, &created, &exited, &kernel, &user)) {
      snapshot.processStarted = (static_cast<ULONGLONG>(created.dwHighDateTime) << 32) | created.dwLowDateTime;
    }
    CloseHandle(process);
  }
  ComPtr<IUIAutomation> automation;
  check(CoCreateInstance(__uuidof(CUIAutomation), nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&automation)));
  ComPtr<IUIAutomationElement> root;
  check(automation->ElementFromHandle(snapshot.hwnd, &root));
  snapshot.title = nameOf(root.Get());
  ComPtr<IUIAutomationTreeWalker> walker;
  check(automation->get_ControlViewWalker(&walker));
  std::vector<ComPtr<IUIAutomationElement>> pending{root};
  size_t visited = 0;
  while (!pending.empty()) {
    if (++visited > MAX_TRAVERSAL_NODES) throw std::runtime_error("Window has too many controls for safe inspection. Narrow the target window.");
    auto element = pending.back(); pending.pop_back();
    BOOL offscreen = TRUE;
    check(element->get_CurrentIsOffscreen(&offscreen));
    if (!offscreen) {
      Control control;
      control.element = element;
      check(element->get_CurrentIsPassword(&control.password));
      // Never read ValuePattern.Value, password names or clipboard content.
      control.name = control.password ? L"<protected>" : nameOf(element.Get());
      check(element->get_CurrentIsEnabled(&control.enabled));
      check(element->get_CurrentHasKeyboardFocus(&control.focused));
      check(element->get_CurrentControlType(&control.type));
      check(element->get_CurrentBoundingRectangle(&control.rect));
      if (snapshot.controls.size() < MAX_RETURNED_CONTROLS) snapshot.controls.push_back(std::move(control));
    }
    ComPtr<IUIAutomationElement> child;
    check(walker->GetFirstChildElement(element.Get(), &child));
    while (child) {
      if (pending.size() + visited >= MAX_TRAVERSAL_NODES) throw std::runtime_error("Window control limit exceeded.");
      pending.push_back(child);
      ComPtr<IUIAutomationElement> sibling;
      check(walker->GetNextSiblingElement(child.Get(), &sibling));
      child = sibling;
    }
  }
  if (GetForegroundWindow() != snapshot.hwnd) throw std::runtime_error("Foreground window changed. Observe again.");
  return snapshot;
}

static std::wstring readField(unsigned int maximum) {
  unsigned int length = 0;
  if (fread(&length, sizeof(length), 1, stdin) != 1 || length == 0 || length > maximum) throw std::runtime_error("Invalid native input length.");
  std::string bytes(length, '\0');
  if (fread(bytes.data(), 1, length, stdin) != length) throw std::runtime_error("Incomplete native input.");
  int count = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, bytes.data(), static_cast<int>(length), nullptr, 0);
  if (!count) throw std::runtime_error("Invalid UTF-8 input.");
  std::wstring value(count, L'\0');
  MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, bytes.data(), static_cast<int>(length), value.data(), count);
  if (value.find(L'\0') != std::wstring::npos) throw std::runtime_error("Null characters are not allowed.");
  return value;
}

static void writeValue(const WindowSnapshot& snapshot, const wchar_t* expectedWindow, const wchar_t* expectedPid) {
  wchar_t* end = nullptr;
  auto window = _wcstoui64(expectedWindow, &end, 16);
  if (!*expectedWindow || *end || window != reinterpret_cast<ULONG_PTR>(snapshot.hwnd)) throw std::runtime_error("Target window changed.");
  auto pid = wcstoul(expectedPid, &end, 10);
  if (!*expectedPid || *end || pid != snapshot.pid) throw std::runtime_error("Target process changed.");
  auto target = readField(640);
  auto value = readField(40'000);
  if (fgetc(stdin) != EOF) throw std::runtime_error("Unexpected native input.");
  if (sensitive(snapshot.title)) throw std::runtime_error("Credential window cannot be edited.");
  std::vector<const Control*> matches;
  for (const auto& control : snapshot.controls) {
    if (control.password || sensitive(control.name)) throw std::runtime_error("Credential control is visible; input blocked.");
    if ((control.type == UIA_EditControlTypeId || control.type == UIA_DocumentControlTypeId) && control.name == target) matches.push_back(&control);
  }
  if (matches.size() != 1 || !matches[0]->enabled) throw std::runtime_error("Choose one enabled, uniquely named text field.");
  ComPtr<IUIAutomationValuePattern> pattern;
  check(matches[0]->element->GetCurrentPatternAs(UIA_ValuePatternId, IID_PPV_ARGS(&pattern)));
  BOOL readOnly = TRUE;
  check(pattern->get_CurrentIsReadOnly(&readOnly));
  if (readOnly) throw std::runtime_error("The text field is read-only.");
  if (GetForegroundWindow() != snapshot.hwnd) throw std::runtime_error("Foreground window changed. Observe again.");
  BSTR bstrValue = SysAllocString(value.c_str());
  if (!bstrValue) throw std::runtime_error("Could not allocate native text value.");
  const HRESULT setResult = pattern->SetValue(bstrValue);
  SysFreeString(bstrValue);
  check(setResult);
  std::cout << "{\"ok\":true,\"protocol\":1}\n";
}

int wmain(int argc, wchar_t** argv) {
  if (argc == 2 && wcscmp(argv[1], L"version") == 0) {
    std::cout << "{\"ok\":true,\"protocol\":1,\"backend\":\"windows-uia\"}\n"; return 0;
  }
  bool initialized = false;
  try {
    if (!((argc == 2 && wcscmp(argv[1], L"inspect") == 0) || (argc == 4 && wcscmp(argv[1], L"set-value") == 0))) throw std::runtime_error("Unsupported native command.");
    _setmode(_fileno(stdin), _O_BINARY);
    check(CoInitializeEx(nullptr, COINIT_MULTITHREADED)); initialized = true;
    {
      auto snapshot = inspect();
      if (argc == 4) writeValue(snapshot, argv[2], argv[3]);
      else {
        char handle[32]; sprintf_s(handle, "%llx", static_cast<unsigned long long>(reinterpret_cast<ULONG_PTR>(snapshot.hwnd)));
        std::cout << "{\"ok\":true,\"protocol\":1,\"windowId\":\"" << handle << "\",\"pid\":" << snapshot.pid;
        if (snapshot.processStarted) std::cout << ",\"processStarted\":\"" << snapshot.processStarted << "\"";
        std::cout << ",\"title\":" << json(snapshot.title) << ",\"controls\":[";
        bool first = true;
        for (const auto& control : snapshot.controls) {
          if (!first) std::cout << ','; first = false;
          std::cout << "{\"title\":" << json(control.name) << ",\"role\":\"" << ((control.type == UIA_EditControlTypeId || control.type == UIA_DocumentControlTypeId) ? "edit" : "control") << "\",\"isPassword\":" << (control.password ? "true" : "false") << ",\"isEnabled\":" << (control.enabled ? "true" : "false") << ",\"isFocused\":" << (control.focused ? "true" : "false") << "}";
        }
        std::cout << "]}\n";
      }
    }
    CoUninitialize(); return 0;
  } catch (const std::exception& error) {
    if (initialized) CoUninitialize();
    std::cerr << error.what() << '\n'; return 1;
  }
}
