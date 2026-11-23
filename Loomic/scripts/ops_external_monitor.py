"""Probe public readiness from an independent host and report sustained outages."""
import argparse
from email.message import EmailMessage
import json
import os
from pathlib import Path
import smtplib
import ssl
import time
import urllib.request


def should_notify(healthy: bool, failures: int, previous: dict, now: float) -> bool:
    if healthy:
        return previous.get('notifiedDown') is True
    return failures >= 2 and (not previous.get('notifiedDown') or now - previous.get('sentAt', 0) >= 3600)


def check(config_path: str) -> dict:
    import fcntl
    config = json.loads(Path(config_path).read_text())
    root = Path(config_path).parent
    with (root/'monitor.lock').open('a+') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        state_path = root/'state.json'
        prior = json.loads(state_path.read_text()) if state_path.exists() else {}
        now = time.time()
        try:
            with urllib.request.urlopen(config['healthUrl'], timeout=20) as response:
                payload = json.load(response)
            healthy = payload.get('ok') is True and all(payload.get('checks', {}).get(name, {}).get('ok') is True for name in ['database','storage','accepting'])
            failure = None
        except Exception as error:
            healthy, failure = False, type(error).__name__
        failures = 0 if healthy else prior.get('failures', 0) + 1
        state = {**prior, 'checkedAt':now, 'healthy':healthy, 'failures':failures, 'error':failure}
        if should_notify(healthy, failures, prior, now):
            status = 'RECOVERED' if healthy else 'HOST ALERT'
            mail = EmailMessage()
            mail['From'], mail['To'] = config['mailFrom'], config['recipient']
            mail['Subject'] = '[Helstera] ' + status + ' studio.0st.top'
            mail.set_content('Independent public HTTPS check\nStatus: '+status+'\nConsecutive failures: '+str(failures)+'\nError category: '+str(failure))
            with smtplib.SMTP(config['mailHost'], config['mailPort'], timeout=20) as smtp:
                smtp.starttls(context=ssl.create_default_context())
                smtp.login(config['mailUser'], config['mailPassword'])
                rejected = smtp.send_message(mail)
                if rejected:
                    raise RuntimeError('External alert recipient rejected')
            state.update({'sentAt':now,'notifiedDown':not healthy})
        pending=state_path.with_suffix('.pending')
        pending.write_text(json.dumps(state,indent=2));pending.chmod(0o600);pending.replace(state_path)
        return state


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config',required=True)
    args=parser.parse_args()
    os.umask(0o077)
    print(json.dumps(check(args.config)))
