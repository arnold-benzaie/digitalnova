type Message = {
  id: string;
  senderRole: string;
  senderName: string;
  body: string;
  createdAt: Date;
};

export function MessageThread({ messages }: { messages: Message[] }) {
  if (messages.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-pm-gris-2 bg-white p-8 text-center">
        <p className="font-serif text-lg font-semibold text-pm-noir">Aucun message pour le moment</p>
        <p className="mt-1 text-sm text-pm-gris">Démarrez la conversation ci-dessous.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {messages.map((message) => {
        const isStaff = message.senderRole === "staff";
        return (
          <div key={message.id} className={`flex ${isStaff ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-md rounded-2xl px-4 py-3 ${
                isStaff ? "bg-pm-noir text-white" : "border border-pm-gris-2 bg-white text-pm-noir"
              }`}
            >
              <div className="flex items-center justify-between gap-4">
                <p className={`text-xs font-medium ${isStaff ? "text-white/70" : "text-pm-gris"}`}>
                  {message.senderName}
                </p>
                <p className={`text-xs ${isStaff ? "text-white/50" : "text-pm-gris"}`}>
                  {new Date(message.createdAt).toLocaleString("fr-FR", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm">{message.body}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
