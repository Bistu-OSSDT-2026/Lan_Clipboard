import SwiftUI

struct Pasteboard: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 12){
            Text("Paste frome device")
                .font(.title2)
                .fontWeight(.black)
                .padding()
        }
    }
}

#Preview {
    Pasteboard()
}
