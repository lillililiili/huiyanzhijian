"""Isolated protocol laboratory. Never writes to the center platform or production edge data."""
import socket, struct, threading, time, math, json, urllib.request, os, pty, select, sys

def crc(data):
    n=65535
    for v in data:
        n ^= v
        for _ in range(8): n=(n>>1)^0xa001 if n&1 else n>>1
    return n

def regs():
    ratio=.990-.015*math.exp(-((time.time()%30-15)/2)**2)+math.sin(time.time()*5)*.0004
    x=40000;y=int(x*ratio)
    return struct.pack('>6H',2,(x+y)//2,x,0,y,0)

def exact(sock,n):
    b=b''
    while len(b)<n:
        chunk=sock.recv(n-len(b))
        if not chunk: raise EOFError()
        b+=chunk
    return b

def client(c):
    try:
        while True:
            q=exact(c,12)
            assert q[7]==3 and q[8:]==bytes([2,0,0,6]),q
            c.sendall(q[:4]+struct.pack('>H',15)+q[6:7]+b'\x03\x0c'+regs())
    except (EOFError,OSError): pass
    finally: c.close()

def tcp():
    s=socket.socket();s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);s.bind(('127.0.0.1',15020));s.listen()
    while True: threading.Thread(target=client,args=(s.accept()[0],),daemon=True).start()

def rtu():
    master,slave=pty.openpty();path=os.ttyname(slave)
    with open('/config/edge-build/lab-serial.txt','w') as f:f.write(path)
    pending=b''
    while True:
        if not select.select([master],[],[],1)[0]:continue
        pending+=os.read(master,1024)
        while len(pending)>=8:
            q,pending=pending[:8],pending[8:]
            if crc(q[:6])!=int.from_bytes(q[6:],'little'):continue
            b=q[:1]+b'\x03\x0c'+regs();os.write(master,b+crc(b).to_bytes(2,'little'))

if __name__=='__main__':
    threading.Thread(target=tcp,daemon=True).start();rtu()
