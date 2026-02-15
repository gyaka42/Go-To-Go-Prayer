#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(WidgetBridge, NSObject)
RCT_EXTERN_METHOD(saveWidgetState:(NSDictionary *)payload)
RCT_EXTERN_METHOD(saveWidgetStateJSON:(NSString *)payloadJSON)
RCT_EXTERN_METHOD(saveWidgetData:(NSString *)nextPrayer
                  time:(NSString *)time
                  location:(NSString *)location)
@end
